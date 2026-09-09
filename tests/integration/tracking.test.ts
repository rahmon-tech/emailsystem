import { test, after } from "node:test";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
import { createUser, login, sessionCookie } from "@emailsystem/core/auth";
import { api } from "@emailsystem/core/api";
import { inspectDestinations } from "@emailsystem/core/reputation";
import { saveProvider } from "@emailsystem/core/providers";
import { importRecipients } from "@emailsystem/core/imports";
import {
  createCampaign,
  preflight,
  campaignSummary,
  prepareCampaign,
} from "@emailsystem/core/campaigns";
import {
  getTracking,
  saveTrackingSettings,
  redirectVisit,
  retainTracking,
} from "@emailsystem/core/tracking";
import { absoluteAppUrl } from "@emailsystem/core/server-paths";

const owners: string[] = [];
after(async () => {
  await db.user.deleteMany({ where: { id: { in: owners } } });
  await db.$disconnect();
  await redis.quit();
});

async function fixture() {
  const user = await createUser(
    `tracking-${crypto.randomUUID()}@example.com`,
    "Isolated tracking test password 2026",
  );
  owners.push(user.id);
  await saveProvider(user.id, {
    name: "Mock",
    type: "mock",
    transport: "api",
    credentials: {},
    settings: { fromEmail: "sender@example.com" },
  });
  const list = await importRecipients(
    user.id,
    Buffer.from("reader@example.net"),
    "people.txt",
  );
  return {
    user,
    data: {
      name: "Tracking test",
      subject: "Faithful copy",
      from: "sender@example.com",
      importId: list.id,
      html: '<p>A faithful message. <a href="https://example.com/offer?a=1&amp;b=2">Read more</a> <a href="https://example.com/offer?a=1&amp;b=2">Again</a> <a href="mailto:support@example.com">Ask us</a></p>',
      startKey: crypto.randomUUID(),
    },
  };
}

test("installation account creation accepts bounded stdin without echoing the password", async () => {
  const email = `cli-${crypto.randomUUID()}@example.com`;
  const password = "Synthetic-stdin-password-$&-2026";
  const result = await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/create-user.ts"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.on("error", reject);
      child.on("exit", (code) => resolve({ code, output }));
      child.stdin.end(`${email}\n${password}\n`);
    },
  );
  assert.equal(result.code, 0);
  assert(!result.output.includes(password));
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  owners.push(user.id);
  assert.notEqual(user.passwordHash, password);
});

test("direct sending needs no click tracking; unknown reputation warns and only explicit policy blocks", async () => {
  const { user, data } = await fixture();
  const tracking = await getTracking(user.id);
  assert.equal(tracking.settings.defaultEnabled, false);
  assert.equal(tracking.appUrl, process.env.APP_URL?.replace(/\/$/, ""));
  const flight = await preflight(user.id, data);
  assert(flight.ready);
  assert(!flight.tracking.enabled);
  assert(flight.warnings.some((warning) => warning.includes("unknown")));
  assert.equal(
    (
      await inspectDestinations(user.id, data.html, [
        {
          id: "affirmative-test-adapter",
          async check() {
            return "REPUTATION_CLEAN";
          },
        },
      ])
    ).links[0].state,
    "REPUTATION_CLEAN",
  );
  const campaign = await createCampaign(user.id, data);
  assert.match(
    (campaign.message as { html: string }).html,
    /href="https:\/\/example.com\/offer\?a=1&amp;b=2"/,
  );
  assert.equal(await db.trackingLink.count({ where: { userId: user.id } }), 0);
  await saveTrackingSettings(user.id, {
    defaultEnabled: false,
    blockUnknown: true,
  });
  assert(!(await preflight(user.id, data)).ready);
  await saveTrackingSettings(user.id, {
    defaultEnabled: false,
    blockUnknown: false,
  });
  assert((await preflight(user.id, data)).ready);
});

test("tracking is an explicit campaign or administrator choice and never gates sending", async () => {
  const { user, data } = await fixture();
  assert((await preflight(user.id, data)).ready);
  assert(
    (await preflight(user.id, { ...data, tracking: { enabled: true } })).ready,
  );
  assert(
    (await preflight(user.id, { ...data, tracking: { enabled: false } })).ready,
  );
  await saveTrackingSettings(user.id, {
    defaultEnabled: true,
    blockUnknown: false,
  });
  assert((await preflight(user.id, data)).tracking.enabled);
  await saveTrackingSettings(user.id, {
    defaultEnabled: false,
    blockUnknown: false,
  });
  assert(!(await preflight(user.id, data)).tracking.enabled);
});

test("campaign links are stable across duplicate submissions, canonical, and immutable", async () => {
  const { user, data } = await fixture();
  const input = { ...data, tracking: { enabled: true } };
  const [first, duplicate] = await Promise.all([
    createCampaign(user.id, input),
    createCampaign(user.id, input),
  ]);
  assert.equal(first.id, duplicate.id);
  const links = await db.trackingLink.findMany({
    where: { campaignId: first.id, userId: user.id },
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].destination, "https://example.com/offer?a=1&b=2");
  assert.equal(
    (first.message as { html: string }).html.split(
      absoluteAppUrl(`/r/${links[0].token}`),
    ).length - 1,
    2,
  );
  assert.match(
    (first.message as { html: string }).html,
    /mailto:support@example.com/,
  );
  const off = await createCampaign(user.id, {
    ...data,
    startKey: crypto.randomUUID(),
    tracking: { enabled: false },
  });
  assert.equal(
    await db.trackingLink.count({ where: { campaignId: off.id } }),
    0,
  );
});

test("redirects reject forged hosts, paths and tokens; visits never change delivery state", async () => {
  const { user, data } = await fixture();
  const campaign = await createCampaign(user.id, {
    ...data,
    tracking: { enabled: true },
  });
  await prepareCampaign(campaign.id);
  const before = await db.delivery.findMany({
    where: { campaignId: campaign.id },
  });
  const link = await db.trackingLink.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  const canonical = new URL(absoluteAppUrl(`/r/${link.token}`));
  const request = (
    method = "GET",
    userAgent = "Mozilla/5.0",
    host = canonical.host,
    url = canonical.href + "?url=https://attacker.example",
  ) =>
    new Request(url, {
      method,
      headers: {
        host,
        "user-agent": userAgent,
        "x-real-ip": "198.51.100.42",
        cookie: "unrelated=secret",
      },
    });
  assert.equal(
    (
      await redirectVisit(
        request("GET", "Mozilla", "other.example"),
        link.token,
      )
    ).status,
    410,
  );
  assert.equal(
    (
      await redirectVisit(
        request(
          "GET",
          "Mozilla",
          canonical.host,
          new URL("/wrong", canonical).href,
        ),
        link.token,
      )
    ).status,
    410,
  );
  assert.equal((await redirectVisit(request(), "forged")).status, 410);
  const results = await Promise.all([
    redirectVisit(request(), link.token),
    redirectVisit(request("HEAD"), link.token),
    redirectVisit(request("GET", "Proofpoint scanner"), link.token),
  ]);
  for (const response of results) {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), link.destination);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert(!response.headers.has("set-cookie"));
  }
  assert.deepEqual(
    await db.delivery.findMany({ where: { campaignId: campaign.id } }),
    before,
  );
  const visits = await db.trackingVisitDay.findMany({
    where: { userId: user.id },
  });
  assert.equal(visits.length, 1);
  assert.equal(visits[0].rawVisits, 3);
  assert.equal(visits[0].likelyAutomated, 2);
  assert.deepEqual(Object.keys(visits[0]).sort(), [
    "day",
    "likelyAutomated",
    "linkId",
    "rawVisits",
    "userId",
  ]);
  const summary = await campaignSummary(user.id, campaign.id);
  assert.equal(summary.tracking.unclassified, 1);
});

test("denied destinations are tenant-scoped, block preflight, and revoke existing redirects", async () => {
  const first = await fixture();
  const second = await fixture();
  const campaign = await createCampaign(first.user.id, {
    ...first.data,
    tracking: { enabled: true },
  });
  const link = await db.trackingLink.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  await db.deniedDestination.create({
    data: { userId: first.user.id, hostname: "example.com" },
  });
  assert(!(await preflight(first.user.id, first.data)).ready);
  assert((await preflight(second.user.id, second.data)).ready);
  const target = new URL(absoluteAppUrl(`/r/${link.token}`));
  assert.equal(
    (
      await redirectVisit(
        new Request(target, { headers: { host: target.host } }),
        link.token,
      )
    ).status,
    410,
  );
});

test("tracking APIs enforce sessions and CSRF; records reject cross-tenant campaign relations", async () => {
  const first = await fixture();
  const second = await fixture();
  const campaign = await createCampaign(first.user.id, first.data);
  const session = await login(
    second.user.email,
    "Isolated tracking test password 2026",
    "tracking-tests",
  );
  const origin = new URL(process.env.APP_URL!).origin;
  const call = (
    path: string,
    method: string,
    token = session.token,
    requestOrigin = origin,
    body = "{}",
  ) =>
    api(
      new Request(origin + "/api/" + path, {
        method,
        headers: {
          Cookie: sessionCookie + "=" + token,
          Origin: requestOrigin,
          "Content-Type": "application/json",
        },
        ...(method !== "GET" ? { body } : {}),
      }),
      path.split("/"),
    );
  assert.equal((await call("tracking", "GET", "")).status, 401);
  assert.equal(
    (await call("tracking", "PUT", session.token, "https://wrong.example"))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        "tracking",
        "PUT",
        session.token,
        origin,
        JSON.stringify({ defaultEnabled: true, blockUnknown: false }),
      )
    ).status,
    200,
  );
  const owned = await (await call("tracking", "GET")).json();
  assert.equal(owned.domains, undefined);
  assert.equal(owned.settings.defaultEnabled, true);
  await assert.rejects(() => campaignSummary(second.user.id, campaign.id));
  await assert.rejects(() =>
    db.trackingLink.create({
      data: {
        userId: second.user.id,
        campaignId: campaign.id,
        token: crypto.randomUUID(),
        destination: "https://example.com",
        expiresAt: new Date(),
      },
    }),
  );
});

test("retention removes expired links and old totals while preserving recent aggregates", async () => {
  const { user, data } = await fixture();
  const campaign = await createCampaign(user.id, {
    ...data,
    tracking: { enabled: true },
  });
  const link = await db.trackingLink.findFirstOrThrow({
    where: { campaignId: campaign.id },
  });
  await db.trackingVisitDay.createMany({
    data: [
      {
        linkId: link.id,
        userId: user.id,
        day: new Date(Date.now() - 400 * 86400000),
        rawVisits: 10,
      },
      { linkId: link.id, userId: user.id, day: new Date(), rawVisits: 2 },
    ],
  });
  await retainTracking();
  assert.equal(
    await db.trackingVisitDay.count({ where: { linkId: link.id } }),
    1,
  );
  await db.trackingLink.update({
    where: { id: link.id },
    data: { expiresAt: new Date(0) },
  });
  await retainTracking();
  assert.equal(
    await db.trackingVisitDay.count({ where: { linkId: link.id } }),
    0,
  );
  assert.equal(await db.trackingLink.count({ where: { id: link.id } }), 0);
});
