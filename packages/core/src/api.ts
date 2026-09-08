import { getSafetySettings, saveSafetySettings } from "./safety";
import { reviewSafety } from "./safety-brakes";
import { z } from "zod";
import { db } from "@emailsystem/db";
import { config } from "./config";
import {
  login,
  logout,
  requireUser,
  assertSameOrigin,
  cookieToken,
  sessionCookie,
  userFromToken,
} from "./auth";
import { response, errorResponse, readBounded, readJson } from "./http";
import { AppError } from "./errors";
import {
  saveProvider,
  verifyProvider,
  testProvider,
  disableProvider,
  providerSelect,
} from "./providers";
import { consumeLimit } from "./redis";
import { importRecipients } from "./imports";
import {
  preflight,
  createCampaign,
  controlCampaign,
  campaignSummary,
} from "./campaigns";
import { normalizeEmail, renderSnapshot } from "@emailsystem/email";
import { messageInput, deliveryMessage } from "./campaigns";
import { getConnection, compatible } from "./providers";
import { csvCell } from "./security";
const uuid = (s: string) => z.uuid().parse(s);
export async function api(request: Request, parts: string[]) {
  try {
    const [area, id, action] = parts;
    const url = new URL(request.url),
      method = request.method;
    if (method !== "GET") assertSameOrigin(request);
    if (area === "auth" && id === "login" && method === "POST") {
      const input = z
        .object({ email: z.email(), password: z.string().min(1).max(256) })
        .strict()
        .parse(await readJson(request, 4096));
      const result = await login(
        input.email,
        input.password,
        request.headers.get("x-real-ip") ?? "direct",
      );
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": `${sessionCookie}=${result.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${config().NODE_ENV === "production" ? "; Secure" : ""}`,
            "Cache-Control": "no-store",
          },
        },
      );
    }
    const user = await requireUser(request);
    if (method !== "GET" && !(await consumeLimit(`mutate:${user.id}`, 120, 60)))
      throw new AppError(429, "RATE", "Too many requests. Try again shortly.");
    if (area === "auth" && id === "logout" && method === "POST") {
      await logout(cookieToken(request));
      return Response.json(
        { ok: true },
        {
          headers: {
            "Set-Cookie": `${sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config().NODE_ENV === "production" ? "; Secure" : ""}`,
          },
        },
      );
    }
    if (area === "me" && method === "GET")
      return response({
        ...user,
        allowMock: config().ALLOW_MOCK_PROVIDER === "true",
        appUrl: config().APP_URL,
        maxUploadBytes: config().MAX_UPLOAD_BYTES,
      });
    if (area === "safety") {
      if (method === "GET" && !id)
        return response(await getSafetySettings(user.id));
      if (method === "PUT" && !id)
        return response(
          await saveSafetySettings(user.id, await readJson(request, 32000)),
        );
      if (method === "POST" && id === "review")
        return response(
          await reviewSafety(user.id, await readJson(request, 2048)),
        );
    }
    if (area === "providers") {
      if (method === "GET" && !id) {
        const providers = await db.providerConnection.findMany({
          where: { userId: user.id, deletedAt: null },
          select: providerSelect,
          orderBy: { createdAt: "desc" },
        });
        const rates = await db.deliveryAttempt.groupBy({
          by: ["providerId", "state"],
          where: {
            userId: user.id,
            startedAt: { gte: new Date(Date.now() - 86400000) },
            state: { notIn: ["NOT_STARTED", "RESERVED"] },
          },
          _count: true,
        });
        return response(
          providers.map((p) => {
            const mine = rates.filter((r) => r.providerId === p.id),
              total = mine.reduce((n, r) => n + r._count, 0),
              accepted = mine.find((r) => r.state === "ACCEPTED")?._count ?? 0;
            return {
              ...p,
              recentAcceptance: total
                ? Math.round((accepted / total) * 100)
                : null,
            };
          }),
        );
      }
      if (method === "POST" && !id)
        return response(
          await saveProvider(user.id, await readJson(request, 32000)),
          201,
        );
      if (id) uuid(id);
      if (method === "PUT" && id)
        return response(
          await saveProvider(user.id, await readJson(request, 32000), id),
        );
      if (method === "POST" && action === "verify")
        return response(await verifyProvider(user.id, id));
      if (method === "POST" && action === "test") {
        if (!(await consumeLimit(`test:${user.id}`, 10, 3600)))
          throw new AppError(
            429,
            "TEST_LIMIT",
            "Test limit reached. Try again later.",
          );
        const data = z
          .object({
            recipient: z.email(),
            testMode: z.boolean().default(false),
          })
          .strict()
          .parse(await readJson(request, 2048));
        return response(
          await testProvider(user.id, id, data.recipient, data.testMode),
        );
      }
      if (method === "POST" && ["disable", "delete"].includes(action)) {
        await disableProvider(user.id, id, action === "delete");
        return response({ ok: true });
      }
      if (method === "GET" && action === "tests")
        return response(
          await db.providerTestDelivery.findMany({
            where: { providerId: id, provider: { userId: user.id } },
            take: 20,
            orderBy: { createdAt: "desc" },
          }),
        );
    }
    if (area === "imports") {
      if (method === "GET")
        return response(
          await db.contactImport.findMany({
            where: { userId: user.id, state: "READY" },
            orderBy: { createdAt: "desc" },
            take: 30,
          }),
        );
      if (method === "POST") {
        if (!(await consumeLimit(`import:${user.id}`, 20, 3600)))
          throw new AppError(
            429,
            "IMPORT_LIMIT",
            "Import limit reached. Try again later.",
          );
        const bytes = await readBounded(
          request,
          config().MAX_UPLOAD_BYTES + 64000,
        );
        const form = await new Response(bytes, {
          headers: {
            "Content-Type": request.headers.get("content-type") ?? "",
          },
        }).formData();
        const file = form.get("file");
        const pasted = form.get("paste");
        if (file instanceof File)
          return response(
            await importRecipients(
              user.id,
              Buffer.from(await file.arrayBuffer()),
              file.name,
            ),
            201,
          );
        if (typeof pasted === "string")
          return response(
            await importRecipients(user.id, Buffer.from(pasted), "pasted.txt"),
            201,
          );
        throw new AppError(
          400,
          "FILE",
          "Choose a file or paste email addresses.",
        );
      }
    }
    if (area === "preview" && method === "POST") {
      const input = z
        .object({
          html: z.string().max(512000),
          preheader: z.string().max(200).default(""),
          text: z.string().max(512000).optional(),
        })
        .strict()
        .parse(await readJson(request));
      const snapshot = normalizeEmail(input.html, input.preheader);
      return response({
        html: renderSnapshot(
          snapshot.html,
          config().APP_URL + "/unsubscribe/preview",
        ),
        text: input.text?.trim() || snapshot.text,
        warnings: snapshot.warnings,
      });
    }
    if (area === "test-message" && method === "POST") {
      if (!(await consumeLimit(`test:${user.id}`, 10, 3600)))
        throw new AppError(
          429,
          "TEST_LIMIT",
          "Test limit reached. Try again later.",
        );
      const data = z
        .object({
          providerId: z.uuid(),
          recipient: z.email().transform((s) => s.toLowerCase()),
          message: messageInput
            .omit({ importId: true, name: true, startKey: true })
            .extend({
              importId: z.string().optional(),
              name: z.string().optional(),
              startKey: z.string().optional(),
            }),
        })
        .strict()
        .parse(await readJson(request));
      const connection = await getConnection(user.id, data.providerId);
      if (!compatible(connection, data.message.from))
        throw new AppError(
          422,
          "PROVIDER",
          "Choose a healthy connection matching the From address.",
        );
      if (
        data.message.attachments.reduce(
          (n, a) => n + Buffer.byteLength(a.content, "base64"),
          0,
        ) > 5000000
      )
        throw new AppError(
          422,
          "ATTACHMENTS",
          "Attachments must total at most 5 MB.",
        );
      if (
        await db.suppression.count({
          where: { userId: user.id, email: data.recipient },
        })
      )
        throw new AppError(
          422,
          "SUPPRESSED",
          "This test recipient is suppressed.",
        );
      const snapshot = normalizeEmail(
        data.message.html,
        data.message.preheader,
      );
      const message = deliveryMessage(
        {
          ...data.message,
          html: snapshot.html,
          text: data.message.text?.trim() || snapshot.text,
          cc: [],
          bcc: [],
        },
        data.recipient,
        "preview",
      );
      return response(
        await testProvider(
          user.id,
          data.providerId,
          data.recipient,
          false,
          message,
        ),
      );
    }
    if (area === "preflight" && method === "POST") {
      const result = await preflight(user.id, await readJson(request));
      return response({
        ready: result.ready,
        problems: result.problems,
        warnings: result.warnings,
        count: result.count,
        safety: result.safety,
        providers: result.providers,
        previewHtml: result.previewHtml,
        text: result.message.text,
        snapshotHash: result.message.snapshotHash,
        importStats: result.importStats,
      });
    }
    if (area === "campaigns") {
      if (method === "POST" && !id) {
        const c = await createCampaign(user.id, await readJson(request));
        return response({ id: c.id, state: c.state }, 201);
      }
      if (method === "GET" && !id) {
        const cursor = url.searchParams.get("cursor");
        if (
          cursor &&
          !(await db.campaign.findFirst({
            where: { id: uuid(cursor), userId: user.id },
          }))
        )
          throw new AppError(400, "CURSOR", "Invalid page cursor.");
        const rows = await db.campaign.findMany({
          where: { userId: user.id },
          select: {
            id: true,
            name: true,
            state: true,
            recipientCount: true,
            intendedRecipientCount: true,
            createdAt: true,
            completedAt: true,
            scheduledAt: true,
            safeError: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 31,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        return response({
          items: rows.slice(0, 30),
          nextCursor: rows.length > 30 ? rows[29].id : null,
        });
      }
      if (id) uuid(id);
      if (method === "GET" && id && !action)
        return response(await campaignSummary(user.id, id));
      if (method === "POST" && ["pause", "resume", "cancel"].includes(action))
        return response(
          await controlCampaign(
            user.id,
            id,
            action as "pause" | "resume" | "cancel",
          ),
        );
      if (method === "GET" && action === "export") {
        await campaignSummary(user.id, id);
        return exportCampaign(user.id, id);
      }
      if (method === "GET" && action === "deliveries") {
        await campaignSummary(user.id, id);
        const state = url.searchParams.get("state");
        const cursor = url.searchParams.get("cursor");
        if (
          cursor &&
          !(await db.delivery.findFirst({
            where: { id: uuid(cursor), userId: user.id, campaignId: id },
          }))
        )
          throw new AppError(400, "CURSOR", "Invalid page cursor.");
        const items = await db.delivery.findMany({
          where: {
            campaignId: id,
            userId: user.id,
            ...(state
              ? {
                  state: z
                    .enum([
                      "PENDING",
                      "QUEUED",
                      "PROCESSING",
                      "PROVIDER_ACCEPTED",
                      "DELIVERED",
                      "DEFERRED",
                      "SOFT_BOUNCED",
                      "HARD_BOUNCED",
                      "FAILED",
                      "COMPLAINED",
                      "UNSUBSCRIBED",
                      "SUPPRESSED",
                      "CANCELLED",
                      "UNKNOWN",
                    ])
                    .parse(state),
                }
              : {}),
          },
          select: {
            id: true,
            email: true,
            state: true,
            attemptCount: true,
            acceptedAt: true,
            deliveredAt: true,
            safeError: true,
          },
          orderBy: { id: "asc" },
          take: 51,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        return response({
          items: items.slice(0, 50),
          nextCursor: items.length > 50 ? items[49].id : null,
        });
      }
    }
    if (area === "activity" && method === "GET")
      return activityStream(
        request,
        user.id,
        url.searchParams.get("campaignId"),
      );
    if (area === "suppressions") {
      if (method === "GET")
        return response(
          await db.suppression.findMany({
            where: {
              userId: user.id,
              ...(url.searchParams.get("email")
                ? {
                    email: {
                      contains: url.searchParams.get("email")!.slice(0, 254),
                    },
                  }
                : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 100,
          }),
        );
      if (method === "POST") {
        const input = z
          .object({ email: z.email().transform((s) => s.toLowerCase()) })
          .parse(await readJson(request, 1024));
        const record = await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${user.id + ":" + input.email},0))::text`;
          return tx.suppression.upsert({
            where: { userId_email: { userId: user.id, email: input.email } },
            create: { userId: user.id, email: input.email, reason: "manual" },
            update: {},
          });
        });
        return response(record, 201);
      }
    }
    throw new AppError(404, "NOT_FOUND", "Endpoint not found.");
  } catch (error) {
    return errorResponse(error);
  }
}
function exportCampaign(userId: string, campaignId: string) {
  let stopped = false;
  const encoder = new TextEncoder();
  let cursor: string | undefined;
  const stream = new ReadableStream({
    async pull(controller) {
      if (stopped) return;
      try {
        if (!cursor)
          controller.enqueue(
            encoder.encode(
              "email,status,provider,provider_message_id,attempts,accepted_at,delivered_at,error\r\n",
            ),
          );
        const rows = await db.delivery.findMany({
          where: { userId, campaignId },
          orderBy: { id: "asc" },
          take: 500,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          include: {
            attempts: {
              orderBy: { startedAt: "desc" },
              take: 1,
              include: { provider: { select: { name: true } } },
            },
          },
        });
        for (const row of rows) {
          const a = row.attempts[0];
          controller.enqueue(
            encoder.encode(
              [
                row.email,
                row.state,
                a?.provider.name,
                a?.providerMessageId,
                row.attemptCount,
                row.acceptedAt?.toISOString(),
                row.deliveredAt?.toISOString(),
                row.safeError,
              ]
                .map(csvCell)
                .join(",") + "\r\n",
            ),
          );
        }
        cursor = rows.at(-1)?.id;
        if (rows.length < 500) {
          stopped = true;
          controller.close();
        }
      } catch {
        stopped = true;
        controller.error(new Error("Export interrupted"));
      }
    },
    cancel() {
      stopped = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campaign-${campaignId}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
async function activityStream(
  request: Request,
  userId: string,
  campaignId: string | null,
) {
  if (campaignId) await campaignSummary(userId, uuid(campaignId));
  const last =
    request.headers.get("last-event-id") ??
    new URL(request.url).searchParams.get("after");
  if (last && !/^\d{1,18}$/.test(last))
    throw new AppError(400, "CURSOR", "Invalid event cursor.");
  const latest = last
    ? null
    : await db.activityEvent.findFirst({
        where: { userId, ...(campaignId ? { campaignId } : {}) },
        orderBy: { id: "desc" },
        select: { id: true },
      });
  let cursor = last
    ? BigInt(last)
    : latest
      ? latest.id > 50n
        ? latest.id - 50n
        : 0n
      : 0n;
  let stopped = false;
  const encoder = new TextEncoder();
  const deadline = Date.now() + 55000;
  const stream = new ReadableStream({
    start(controller) {
      void (async () => {
        try {
          while (!stopped && !request.signal.aborted && Date.now() < deadline) {
            if (!(await userFromToken(cookieToken(request)))) break;
            const events = await db.activityEvent.findMany({
              where: {
                userId,
                id: { gt: cursor },
                ...(campaignId ? { campaignId } : {}),
              },
              orderBy: { id: "asc" },
              take: 100,
            });
            for (const event of events) {
              if (stopped) break;
              cursor = event.id;
              controller.enqueue(
                encoder.encode(
                  `id: ${cursor}\ndata: ${JSON.stringify({ ...event, id: String(event.id) })}\n\n`,
                ),
              );
            }
            if (!stopped) controller.enqueue(encoder.encode(": keepalive\n\n"));
            await new Promise((r) => setTimeout(r, 2000));
          }
        } catch {
          if (!stopped)
            controller.enqueue(
              encoder.encode("event: reconnect\ndata: {}\n\n"),
            );
        } finally {
          if (!stopped) {
            stopped = true;
            controller.close();
          }
        }
      })();
    },
    cancel() {
      stopped = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
