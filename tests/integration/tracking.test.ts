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
  addTrackingDomain,
  verifyDomain,
  disableDomain,
  getTracking,
  saveTrackingSettings,
  redirectVisit,
  retainTracking,
} from "@emailsystem/core/tracking";
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
  const data = {
    name: "Tracking test",
    subject: "Faithful copy",
    from: "sender@example.com",
    importId: list.id,
    html: '<p>A faithful message. <a href="https://example.com/offer?a=1&amp;b=2">Read more</a> <a href="mailto:support@example.com">Ask us</a></p>',
    startKey: crypto.randomUUID(),
  };
  return { user, data };
}
async function domain(userId: string) {
  const d = await addTrackingDomain(userId, {
    hostname: `click-${crypto.randomUUID()}.example.com`,
  });
  await verifyDomain(userId, d.id, async () => true);
  return d;
}
test("installation account creation accepts bounded stdin without echoing the password", async () => {
  const email = `cli-${crypto.randomUUID()}@example.com`,
    password = "Synthetic-stdin-password-$&-2026";
  const result = await new Promise<{ code: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "scripts/create-user.ts"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
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
test("direct sending needs no tracking domain; unknown reputation warns and only explicit policy blocks", async () => {
  const { user, data } = await fixture();
  const flight = await preflight(user.id, data);
  assert(flight.ready);
  assert(!flight.tracking.enabled);
  assert(flight.warnings.some((w) => w.includes("unknown")));
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
  const c = await createCampaign(user.id, data);
  assert.match(
    (c.message as { html: string }).html,
    /href="https:\/\/example.com\/offer\?a=1&amp;b=2"/,
  );
  assert.equal(await db.trackingLink.count({ where: { userId: user.id } }), 0);
  await saveTrackingSettings(user.id, { blockUnknown: true });
  assert(!(await preflight(user.id, data)).ready);
  await saveTrackingSettings(user.id, { blockUnknown: false });
  assert((await preflight(user.id, data)).ready);
});
test("unverified, disabled, expired and foreign hostnames cannot enable tracking; defaults require explicit choice", async () => {
  const { user, data } = await fixture(),
    other = await fixture();
  const unverified = await addTrackingDomain(user.id, {
    hostname: `unverified-${crypto.randomUUID()}.example.com`,
  });
  await assert.rejects(() =>
    saveTrackingSettings(user.id, {
      defaultEnabled: true,
      defaultDomainId: unverified.id,
    }),
  );
  const mine = await domain(user.id),
    theirs = await domain(other.user.id);
  assert.equal((await getTracking(user.id)).settings.defaultEnabled, false);
  assert(
    !(
      await preflight(user.id, {
        ...data,
        tracking: { enabled: true, domainId: theirs.id },
      })
    ).ready,
  );
  await disableDomain(user.id, mine.id);
  assert(
    !(
      await preflight(user.id, {
        ...data,
        tracking: { enabled: true, domainId: mine.id },
      })
    ).ready,
  );
  assert(
    (await preflight(user.id, { ...data, tracking: { enabled: false } })).ready,
  );
  await verifyDomain(user.id, mine.id, async () => true);
  await saveTrackingSettings(user.id, {
    defaultEnabled: true,
    defaultDomainId: mine.id,
  });
  assert((await preflight(user.id, data)).tracking.enabled);
  await db.trackingDomain.update({
    where: { id: mine.id },
    data: { verifiedUntil: new Date(0) },
  });
  assert((await preflight(user.id, data)).ready);
  assert(!(await preflight(user.id, data)).tracking.enabled);
});
test("verification cannot silently undo a concurrent administrator disable", async () => {
  const { user } = await fixture(),
    d = await domain(user.id);
  await assert.rejects(
    () =>
      verifyDomain(user.id, d.id, async () => {
        await disableDomain(user.id, d.id);
        return true;
      }),
    /changed/,
  );
  assert.equal(
    (await db.trackingDomain.findUniqueOrThrow({ where: { id: d.id } }))
      .enabled,
    false,
  );
});
test("campaign links are stable across duplicate submissions, scoped to selected hostname and immutable destinations", async () => {
  const { user, data } = await fixture(),
    first = await domain(user.id),
    second = await domain(user.id);
  const input = { ...data, tracking: { enabled: true, domainId: first.id } };
  const [a, b] = await Promise.all([
    createCampaign(user.id, input),
    createCampaign(user.id, input),
  ]);
  assert.equal(a.id, b.id);
  const links = await db.trackingLink.findMany({
    where: { campaignId: a.id, userId: user.id },
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].domainId, first.id);
  assert.equal(links[0].destination, "https://example.com/offer?a=1&b=2");
  assert.match(
    (a.message as { html: string }).html,
    /mailto:support@example.com/,
  );
  assert(!JSON.stringify(a.message).includes(second.hostname));
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
test("redirects reject forged hosts/tokens, ignore query destinations, and visits never change delivery state", async () => {
  const { user, data } = await fixture(),
    d = await domain(user.id);
  const c = await createCampaign(user.id, {
    ...data,
    tracking: { enabled: true, domainId: d.id },
  });
  await prepareCampaign(c.id);
  const before = await db.delivery.findMany({ where: { campaignId: c.id } });
  const link = await db.trackingLink.findFirstOrThrow({
    where: { campaignId: c.id },
  });
  const req = (host: string, method = "GET", ua = "Mozilla/5.0") =>
    new Request(
      `https://${host}/r/${link.token}?url=https://attacker.example`,
      {
        method,
        headers: {
          host,
          "user-agent": ua,
          "x-real-ip": "198.51.100.42",
          cookie: "unrelated=secret",
        },
      },
    );
  assert.equal(
    (await redirectVisit(req("other.example.com"), link.token)).status,
    410,
  );
  assert.equal((await redirectVisit(req(d.hostname), "forged")).status, 410);
  const results = await Promise.all([
    redirectVisit(req(d.hostname), link.token),
    redirectVisit(req(d.hostname, "HEAD"), link.token),
    redirectVisit(req(d.hostname, "GET", "Proofpoint scanner"), link.token),
  ]);
  for (const r of results) {
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("location"), link.destination);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert(!r.headers.has("set-cookie"));
  }
  assert.deepEqual(
    await db.delivery.findMany({ where: { campaignId: c.id } }),
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
  const summary = await campaignSummary(user.id, c.id);
  assert.equal(summary.tracking.unclassified, 1);
  await disableDomain(user.id, d.id);
  assert.equal((await redirectVisit(req(d.hostname), link.token)).status, 410);
});
test("denied destinations are tenant-scoped, block before send and revoke existing redirects", async () => {
  const a = await fixture(),
    b = await fixture(),
    d = await domain(a.user.id);
  const c = await createCampaign(a.user.id, {
    ...a.data,
    tracking: { enabled: true, domainId: d.id },
  });
  const link = await db.trackingLink.findFirstOrThrow({
    where: { campaignId: c.id },
  });
  await db.deniedDestination.create({
    data: { userId: a.user.id, hostname: "example.com" },
  });
  assert(!(await preflight(a.user.id, a.data)).ready);
  assert((await preflight(b.user.id, b.data)).ready);
  assert.equal(
    (
      await redirectVisit(
        new Request(`https://${d.hostname}/r/${link.token}`, {
          headers: { host: d.hostname },
        }),
        link.token,
      )
    ).status,
    410,
  );
});
test("tracking APIs enforce sessions, CSRF and ownership; database rejects cross-tenant relations", async () => {
  const a = await fixture(),
    b = await fixture(),
    da = await domain(a.user.id),
    dbb = await domain(b.user.id);
  const c = await createCampaign(a.user.id, a.data);
  const session = await login(
    b.user.email,
    "Isolated tracking test password 2026",
    "tracking-tests",
  );
  const origin = new URL(process.env.APP_URL!).origin;
  const call = (
    path: string,
    method: string,
    token = session.token,
    requestOrigin = origin,
  ) =>
    api(
      new Request(origin + "/api/" + path, {
        method,
        headers: {
          Cookie: sessionCookie + "=" + token,
          Origin: requestOrigin,
          "Content-Type": "application/json",
        },
        ...(method !== "GET" ? { body: "{}" } : {}),
      }),
      path.split("/"),
    );
  assert.equal((await call("tracking", "GET", "")).status, 401);
  assert.equal(
    (
      await call(
        `tracking/${da.id}/disable`,
        "POST",
        session.token,
        "https://wrong.example",
      )
    ).status,
    403,
  );
  assert.equal((await call(`tracking/${da.id}/disable`, "POST")).status, 404);
  assert.equal((await call(`tracking/${da.id}/verify`, "POST")).status, 404);
  const owned = await (await call("tracking", "GET")).json();
  assert.equal(owned.domains.length, 1);
  assert.equal(owned.domains[0].id, dbb.id);
  await assert.rejects(() => campaignSummary(b.user.id, c.id));
  await assert.rejects(() =>
    db.trackingLink.create({
      data: {
        userId: a.user.id,
        campaignId: c.id,
        domainId: dbb.id,
        token: crypto.randomUUID(),
        destination: "https://example.com",
        expiresAt: new Date(),
      },
    }),
  );
});
test("retention removes expired links and old visit totals while keeping recent totals", async () => {
  const { user, data } = await fixture(),
    d = await domain(user.id);
  const c = await createCampaign(user.id, {
    ...data,
    tracking: { enabled: true, domainId: d.id },
  });
  const link = await db.trackingLink.findFirstOrThrow({
    where: { campaignId: c.id },
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
