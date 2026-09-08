import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import MailComposer from "nodemailer/lib/mail-composer";
import {
  SESv2Client,
  GetAccountCommand,
  GetEmailIdentityCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { lookup } from "node:dns/promises";
import { Socket } from "node:net";
import ipaddr from "ipaddr.js";
import {
  catalog,
  connectionSchema,
  endpoints,
  definition,
  supportsTestMode,
  smtpCredentials,
} from "./catalog";
import type { Connection } from "./catalog";
import { safeMessages } from "./types";
import type {
  ProviderMessage,
  SendContext,
  ProviderError,
  SendResult,
  Verification,
  ErrorCategory,
} from "./types";
export { catalog, connectionSchema, endpoints, definition, supportsTestMode };
export type { Connection, ConnectionInput, ProviderType } from "./catalog";
export type * from "./types";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const path = (v: unknown, ...keys: string[]): unknown =>
  keys.reduce((o, k) => obj(o)[k], v);
const addr = (email: string, name = "") =>
  name
    ? `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}" <${email}>`
    : email;
export function normalizeError(
  status: number | undefined,
  detail = "",
  retryAfter?: string,
  protocol: "http" | "smtp" = "http",
): ProviderError {
  let category: ErrorCategory = "unknown";
  if (
    /suspend|abuse|policy block|account.*(disabled|banned)|enforcement/i.test(
      detail,
    )
  )
    category = "policy";
  else if (
    status === 401 ||
    /"name"\s*:\s*"invalid_api_key"/.test(detail) ||
    (protocol === "smtp" && status === 535)
  )
    category = "authentication";
  else if (
    /(sender|domain).*(unverified|not verified|verify|unauthorized)|not.*verified.*(sender|domain)/i.test(
      detail,
    )
  )
    category = "sender_configuration";
  else if (status === 403) category = "authorization";
  else if (
    status === 429 ||
    (protocol === "smtp" && (status === 421 || status === 454))
  )
    category = "rate_limit";
  else if (
    status &&
    ((protocol === "http" && (status >= 500 || status === 408)) ||
      (protocol === "smtp" && status >= 400 && status < 500))
  )
    category = "temporary";
  else if (status && (status >= 400 || status >= 550)) category = "permanent";
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now();
    if (!Number.isFinite(retryAfterMs)) retryAfterMs = undefined;
  }
  return {
    category,
    message: safeMessages[category],
    ...(retryAfterMs
      ? { retryAfterMs: Math.min(86400000, Math.max(0, retryAfterMs)) }
      : {}),
  };
}
export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | FormData;
}
function auth(c: Connection): Record<string, string> {
  const s = c.credentials;
  switch (definition(c.type).api?.auth) {
    case "bearer":
      return { Authorization: `Bearer ${s.apiKey}` };
    case "basic-api":
      return {
        Authorization: `Basic ${Buffer.from("api:" + s.apiKey).toString("base64")}`,
      };
    case "basic":
      return {
        Authorization: `Basic ${Buffer.from(s.apiKey + ":" + s.secretKey).toString("base64")}`,
      };
    case "api-key":
      return { "api-key": s.apiKey };
    case "postmark":
      return {
        "X-Postmark-Server-Token": s.serverToken,
        Accept: "application/json",
      };
    case "smtp2go":
      return { "X-Smtp2go-Api-Key": s.apiKey };
    case "elastic":
      return { "X-ElasticEmail-ApiKey": s.apiKey };
    default:
      return {};
  }
}
export function buildRequest(
  c: Connection,
  m: ProviderMessage,
  ctx: SendContext,
): HttpRequest {
  if (ctx.testMode && !supportsTestMode(c))
    throw new Error(
      "Non-delivery test mode is unavailable for this connection",
    );
  const url = endpoints(c).sendUrl;
  if (!url) throw new Error("Provider uses SDK or SMTP");
  const headers = { ...auth(c), "Content-Type": "application/json" };
  const from = addr(m.from, m.fromName);
  const list = (emails: string[]) => emails.map((email) => ({ email }));
  const caps = (emails: string[]) => emails.map((Email) => ({ Email }));
  let body: unknown;
  switch (c.type) {
    case "resend":
      body = {
        from,
        to: [m.to],
        cc: m.cc,
        bcc: m.bcc,
        reply_to: m.replyTo || undefined,
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: m.headers,
        attachments: m.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          content_type: a.contentType,
        })),
        tags: [{ name: "attempt", value: ctx.attemptId }],
      };
      Object.assign(headers, { "Idempotency-Key": ctx.idempotencyKey });
      break;
    case "sendgrid":
      body = {
        personalizations: [
          {
            to: list([m.to]),
            ...(m.cc.length ? { cc: list(m.cc) } : {}),
            ...(m.bcc.length ? { bcc: list(m.bcc) } : {}),
            custom_args: { es_attempt: ctx.attemptId },
          },
        ],
        from: { email: m.from, name: m.fromName },
        ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}),
        subject: m.subject,
        content: [
          { type: "text/plain", value: m.text },
          { type: "text/html", value: m.html },
        ],
        headers: m.headers,
        ...(m.attachments.length
          ? {
              attachments: m.attachments.map((a) => ({
                content: a.content,
                filename: a.filename,
                type: a.contentType,
                disposition: "attachment",
              })),
            }
          : {}),
      };
      break;
    case "brevo":
      body = {
        sender: { email: m.from, name: m.fromName },
        to: list([m.to]),
        ...(m.cc.length ? { cc: list(m.cc) } : {}),
        ...(m.bcc.length ? { bcc: list(m.bcc) } : {}),
        ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
        subject: m.subject,
        htmlContent: m.html,
        textContent: m.text,
        headers: {
          ...m.headers,
          "X-Mailin-custom": `es_attempt:${ctx.attemptId}`,
          ...(ctx.testMode ? { "X-Sib-Sandbox": "drop" } : {}),
        },
        attachment: m.attachments.map((a) => ({
          name: a.filename,
          content: a.content,
        })),
      };
      break;
    case "postmark":
      body = {
        From: from,
        To: m.to,
        Cc: m.cc.join(","),
        Bcc: m.bcc.join(","),
        ReplyTo: m.replyTo,
        Subject: m.subject,
        HtmlBody: m.html,
        TextBody: m.text,
        MessageStream: c.settings.messageStream,
        Metadata: { es_attempt: ctx.attemptId },
        Headers: Object.entries(m.headers).map(([Name, Value]) => ({
          Name,
          Value,
        })),
        Attachments: m.attachments.map((a) => ({
          Name: a.filename,
          Content: a.content,
          ContentType: a.contentType,
        })),
      };
      break;
    case "mailjet":
      body = {
        SandboxMode: ctx.testMode ?? false,
        Messages: [
          {
            From: { Email: m.from, Name: m.fromName },
            To: caps([m.to]),
            Cc: caps(m.cc),
            Bcc: caps(m.bcc),
            ...(m.replyTo ? { ReplyTo: { Email: m.replyTo } } : {}),
            Subject: m.subject,
            HTMLPart: m.html,
            TextPart: m.text,
            Headers: m.headers,
            CustomID: ctx.attemptId,
            Attachments: m.attachments.map((a) => ({
              Filename: a.filename,
              Base64Content: a.content,
              ContentType: a.contentType,
            })),
          },
        ],
      };
      break;
    case "smtp2go":
      body = {
        sender: from,
        to: [m.to],
        cc: m.cc,
        bcc: m.bcc,
        subject: m.subject,
        html_body: m.html,
        text_body: m.text,
        custom_headers: Object.entries({
          ...m.headers,
          ...(m.replyTo ? { "Reply-To": m.replyTo } : {}),
          "X-EmailSystem-Attempt": ctx.attemptId,
        }).map(([header, value]) => ({ header, value })),
        attachments: m.attachments.map((a) => ({
          filename: a.filename,
          fileblob: a.content,
          mimetype: a.contentType,
        })),
      };
      break;
    case "elastic":
      body = {
        Recipients: { To: [m.to], CC: m.cc, BCC: m.bcc },
        Content: {
          From: from,
          ReplyTo: m.replyTo,
          Subject: m.subject,
          Body: [
            { ContentType: "HTML", Content: m.html },
            { ContentType: "PlainText", Content: m.text },
          ],
          Headers: { ...m.headers, "X-EmailSystem-Attempt": ctx.attemptId },
          Attachments: m.attachments.map((a) => ({
            Name: a.filename,
            BinaryContent: a.content,
            ContentType: a.contentType,
          })),
        },
      };
      break;
    case "mailgun": {
      const values: Record<string, string> = {
        from,
        to: m.to,
        cc: m.cc.join(","),
        bcc: m.bcc.join(","),
        subject: m.subject,
        html: m.html,
        text: m.text,
        "v:es_attempt": ctx.attemptId,
        ...(m.replyTo ? { "h:Reply-To": m.replyTo } : {}),
        ...(ctx.testMode ? { "o:testmode": "yes" } : {}),
      };
      for (const [k, v] of Object.entries(m.headers)) values["h:" + k] = v;
      if (m.attachments.length) {
        const form = new FormData();
        for (const [k, v] of Object.entries(values)) form.append(k, v);
        for (const a of m.attachments)
          form.append(
            "attachment",
            new Blob([Buffer.from(a.content, "base64")], {
              type: a.contentType,
            }),
            a.filename,
          );
        return { url, method: "POST", headers: auth(c), body: form };
      }
      return {
        url,
        method: "POST",
        headers: {
          ...auth(c),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(values).toString(),
      };
    }
    default:
      throw new Error("Unsupported API provider");
  }
  return { url, method: "POST", headers, body: JSON.stringify(body) };
}
export interface Dependencies {
  fetch?: typeof fetch;
  smtp?: () => ReturnType<typeof nodemailer.createTransport>;
  ses?: { send: (command: unknown) => Promise<unknown> };
}
async function request(req: HttpRequest, deps: Dependencies) {
  const response = await (deps.fetch ?? fetch)(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (Number(response.headers.get("content-length") ?? 0) > 1048576)
    throw new Error("Provider response exceeds limit");
  let raw = "";
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  if (reader)
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1048576) {
          await reader.cancel();
          throw new Error("Provider response exceeds limit");
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  if (raw.length > 1048576) throw new Error("Provider response exceeds limit");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  return { response, data };
}
export async function publicSmtpAddress(host: string) {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(host) ||
    host.toLowerCase() === "localhost"
  )
    throw new Error("SMTP host must be a public hostname");
  const addresses = await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some((a) => ipaddr.process(a.address).range() !== "unicast")
  )
    throw new Error("SMTP host resolves to a non-public network");
  return addresses[0].address;
}
async function withSmtp<T>(
  c: Connection,
  deps: Dependencies,
  operation: (
    transport: ReturnType<typeof nodemailer.createTransport>,
  ) => Promise<T>,
): Promise<T> {
  // SMTP inactivity timers alone allow a slow peer to outlive the 120s lease.
  // Bound the whole operation, including DNS, and tear down the actual socket.
  let socket: Socket | undefined;
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  timer.unref();
  const expired = new Promise<never>((_, reject) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        socket?.destroy();
        reject(new Error("SMTP operation exceeded its deadline"));
      },
      { once: true },
    );
  });
  try {
    return await Promise.race([
      expired,
      (async () => {
        if (deps.smtp) transport = deps.smtp();
        else {
          const ep = endpoints(c);
          if (!ep.smtpHost) throw new Error("Missing SMTP hostname");
          const address = await publicSmtpAddress(ep.smtpHost);
          controller.signal.throwIfAborted();
          socket = new Socket();
          transport = nodemailer.createTransport({
            ...buildSmtpOptions(c, address),
            socket,
          });
        }
        return operation(transport);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    socket?.destroy();
    transport?.close();
  }
}
export function buildSmtpOptions(
  c: Connection,
  address: string,
): SMTPTransport.Options {
  const ep = endpoints(c);
  const secure = ep.security === "tls";
  return {
    host: address,
    port: ep.port,
    secure,
    requireTLS: !secure,
    auth: smtpCredentials(c),
    tls: { servername: ep.smtpHost, rejectUnauthorized: true },
    connectionTimeout: c.settings.timeout,
    greetingTimeout: c.settings.timeout,
    socketTimeout: c.settings.timeout,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
function mailOptions(m: ProviderMessage, ctx: SendContext, c: Connection) {
  return {
    from: { address: m.from, name: m.fromName },
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    replyTo: m.replyTo || undefined,
    subject: m.subject,
    html: m.html,
    text: m.text,
    messageId: `<${ctx.attemptId}@${m.from.split("@")[1]}>`,
    headers: {
      ...m.headers,
      "X-EmailSystem-Attempt": ctx.attemptId,
      ...(c.type === "resend"
        ? { "Resend-Idempotency-Key": ctx.idempotencyKey }
        : {}),
      ...(c.type === "postmark"
        ? { "X-PM-Message-Stream": c.settings.messageStream }
        : {}),
      ...(c.type === "mailgun"
        ? {
            "X-Mailgun-Variables": JSON.stringify({
              es_attempt: ctx.attemptId,
            }),
          }
        : {}),
    },
    attachments: m.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content, "base64"),
      contentType: a.contentType,
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}
function ses(c: Connection, deps: Dependencies, timeout = 20000) {
  return (
    deps.ses ??
    new SESv2Client({
      region: c.settings.region ?? definition("ses").regions![0],
      maxAttempts: 1,
      requestHandler: {
        connectionTimeout: Math.min(timeout, 10000),
        requestTimeout: timeout,
        throwOnRequestTimeout: true,
      },
      credentials: {
        accessKeyId: c.credentials.accessKeyId,
        secretAccessKey: c.credentials.secretAccessKey,
        ...(c.credentials.sessionToken
          ? { sessionToken: c.credentials.sessionToken }
          : {}),
      },
    })
  );
}
export async function send(
  c: Connection,
  m: ProviderMessage,
  ctx: SendContext,
  deps: Dependencies = {},
): Promise<SendResult> {
  if (ctx.testMode && !supportsTestMode(c))
    return {
      status: "rejected",
      error: {
        category: "permanent",
        message: "Non-delivery test mode is unavailable for this connection.",
      },
    };
  try {
    if (c.type === "mock") {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_MOCK_PROVIDER !== "true"
      )
        throw new Error("Mock provider is disabled");
      if (c.settings.mockMode === "delay")
        await new Promise((r) => setTimeout(r, 1500));
      const mode = c.settings.mockMode;
      if (["temporary", "rate_limit", "permanent", "unknown"].includes(mode)) {
        const category = mode as ErrorCategory;
        return {
          status: mode === "unknown" ? "unknown" : "rejected",
          error: { category, message: safeMessages[category] },
        };
      }
      return { status: "accepted", providerMessageId: "mock-" + ctx.attemptId };
    }
    if (c.transport === "smtp") {
      return await withSmtp(c, deps, async (transport) => {
        const result = await transport.sendMail(mailOptions(m, ctx, c));
        const accepted = (result.accepted ?? []).map((v: unknown) =>
          typeof v === "string" ? v : obj(v).address,
        );
        if (!accepted.includes(m.to))
          return {
            status: accepted.length ? "unknown" : "rejected",
            error: normalizeError(accepted.length ? undefined : 550),
          };
        return { status: "accepted", providerMessageId: result.messageId };
      });
    }
    if (c.type === "ses") {
      const raw = await new MailComposer(mailOptions(m, ctx, c))
        .compile()
        .build();
      const result = await ses(c, deps).send(
        new SendEmailCommand({
          FromEmailAddress: addr(m.from, m.fromName),
          Destination: {
            ToAddresses: [m.to],
            CcAddresses: m.cc,
            BccAddresses: m.bcc,
          },
          Content: { Raw: { Data: raw } },
          EmailTags: [{ Name: "es_attempt", Value: ctx.attemptId }],
        }),
      );
      const id = obj(result).MessageId;
      if (typeof id !== "string")
        return { status: "unknown", error: normalizeError(undefined) };
      return { status: "accepted", providerMessageId: id };
    }
    const { response, data } = await request(buildRequest(c, m, ctx), deps);
    const detail = JSON.stringify(data);
    if (!response.ok)
      return {
        status: "rejected",
        error: normalizeError(
          response.status,
          detail,
          response.headers.get("retry-after") ?? undefined,
        ),
      };
    if (c.type === "postmark" && obj(data).ErrorCode !== 0)
      return { status: "rejected", error: normalizeError(400, detail) };
    if (
      c.type === "mailjet" &&
      obj(arr(obj(data).Messages)[0]).Status !== "success"
    )
      return { status: "rejected", error: normalizeError(400, detail) };
    if (
      c.type === "smtp2go" &&
      (Number(path(data, "data", "failed") ?? 0) > 0 ||
        path(data, "data", "error"))
    )
      return { status: "rejected", error: normalizeError(400, detail) };
    if (c.type === "mailjet" && ctx.testMode)
      return { status: "accepted", providerMessageId: null };
    const id =
      c.type === "resend" || c.type === "mailgun"
        ? obj(data).id
        : c.type === "sendgrid"
          ? response.headers.get("x-message-id")
          : c.type === "brevo"
            ? obj(data).messageId
            : c.type === "postmark"
              ? obj(data).MessageID
              : c.type === "mailjet"
                ? obj(arr(obj(arr(obj(data).Messages)[0]).To)[0]).MessageUUID
                : c.type === "smtp2go"
                  ? path(data, "data", "email_id")
                  : obj(data).MessageID;
    if (typeof id !== "string" || !id)
      return { status: "unknown", error: normalizeError(undefined) };
    return { status: "accepted", providerMessageId: id };
  } catch (error) {
    const e = obj(error);
    const status =
      typeof e.responseCode === "number"
        ? e.responseCode
        : typeof path(e, "$metadata", "httpStatusCode") === "number"
          ? Number(path(e, "$metadata", "httpStatusCode"))
          : undefined;
    const normalized = normalizeError(
      status,
      typeof e.message === "string" ? e.message : "",
      undefined,
      c.transport === "smtp" ? "smtp" : "http",
    );
    return { status: status ? "rejected" : "unknown", error: normalized };
  }
}
const check = (
  name: string,
  status: "passed" | "failed" | "unknown",
  detail: string,
) => ({ name, status, detail });
const result = (
  status: string,
  usable: boolean,
  ...checks: Verification["checks"]
): Verification => ({ status, usable, checks });
const probe = (c: Connection): ProviderMessage => ({
  from: c.settings.fromEmail,
  fromName: c.settings.fromName,
  // Used only with provider-native non-delivery validation.
  to: c.settings.fromEmail,
  cc: [],
  bcc: [],
  replyTo: c.settings.replyTo,
  subject: "EmailSystem connection verification",
  html: "<p>Connection verification.</p>",
  text: "Connection verification.",
  headers: {},
  attachments: [],
});
export async function verifyConnection(
  c: Connection,
  deps: Dependencies = {},
): Promise<Verification> {
  const strategy = definition(c.type).verification;
  try {
    if (strategy === "mock") {
      if (
        process.env.NODE_ENV === "production" &&
        process.env.ALLOW_MOCK_PROVIDER !== "true"
      )
        return result(
          "DISABLED",
          false,
          check("Mock", "failed", "Mock provider is disabled in production."),
        );
      return result(
        "HEALTHY",
        true,
        check(
          "Simulation",
          "passed",
          "Development adapter; no real email is sent.",
        ),
      );
    }
    if (c.transport === "smtp") {
      return await withSmtp(c, deps, async (transport) => {
        await transport.verify();
        if (
          c.type === "postmark" &&
          c.settings.messageStreamType === "transactional"
        )
          return result(
            "CONFIG_ERROR",
            false,
            check(
              "Message Stream",
              "failed",
              "Transactional SMTP is available for explicit tests only. Campaigns require a Broadcast stream.",
            ),
          );
        return result(
          "HEALTHY",
          true,
          check(
            "TLS and authentication",
            "passed",
            "Secure SMTP connection authenticated.",
          ),
          check(
            "Sender permission",
            "unknown",
            "SMTP authentication does not prove sender or recipient acceptance. Use Send Test Email.",
          ),
        );
      });
    }
    if (strategy === "ses-account") {
      const client = ses(c, deps, 5000);
      const account = obj(await client.send(new GetAccountCommand({})));
      if (
        account.SendingEnabled !== true ||
        account.EnforcementStatus === "SHUTDOWN"
      )
        return result(
          "POLICY_BLOCKED",
          false,
          check(
            "Sending",
            "failed",
            "SES sending is disabled; review the account.",
          ),
        );
      const identity = obj(
        await client.send(
          new GetEmailIdentityCommand({
            EmailIdentity: c.settings.domain ?? c.settings.fromEmail,
          }),
        ),
      );
      if (identity.VerifiedForSendingStatus !== true)
        return result(
          "SENDER_UNVERIFIED",
          false,
          check("Sender", "failed", "Verify this SES sending identity."),
        );
      const sandbox = account.ProductionAccessEnabled !== true;
      const quota = obj(account.SendQuota);
      const remaining =
        typeof quota.Max24HourSend === "number" && quota.Max24HourSend >= 0
          ? Math.max(
              0,
              Math.floor(
                quota.Max24HourSend - Number(quota.SentLast24Hours ?? 0),
              ),
            )
          : undefined;
      const exhausted = remaining === 0;
      return {
        ...result(
          sandbox ? "SANDBOX" : exhausted ? "THROTTLED" : "HEALTHY",
          !sandbox && !exhausted,
          check("Account", "passed", "SES account authenticated."),
          check("Sender", "passed", "Identity is verified."),
          check(
            "Sending quota",
            exhausted ? "failed" : "passed",
            remaining === undefined
              ? "No finite daily quota reported."
              : `${remaining} recipients remaining in the SES rolling 24-hour quota.`,
          ),
          check(
            "Enforcement",
            account.EnforcementStatus === "PROBATION" ? "unknown" : "passed",
            account.EnforcementStatus === "PROBATION"
              ? "Account is under probation; review SES guidance."
              : "Sending is enabled.",
          ),
          check(
            "Production access",
            sandbox ? "failed" : "passed",
            sandbox
              ? "SES sandbox restricts recipients. Request production access before campaigns."
              : "SES production access enabled.",
          ),
        ),
        maxSendRate: Number(path(account, "SendQuota", "MaxSendRate") ?? 1),
        quotaRemaining: remaining,
      };
    }
    if (strategy === "native-sandbox") {
      const { response, data } = await request(
        buildRequest(c, probe(c), {
          attemptId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          testMode: true,
        }),
        deps,
      );
      if (!response.ok || obj(arr(obj(data).Messages)[0]).Status !== "success")
        return verificationError(
          response.ok ? 400 : response.status,
          JSON.stringify(data),
        );
      return result(
        "HEALTHY",
        true,
        check(
          "Sandbox validation",
          "passed",
          "Credentials, sender and payload accepted without delivery.",
        ),
      );
    }
    const ep = endpoints(c);
    const { response, data } = await request(
      {
        url: ep.verifyUrl!,
        method: c.type === "smtp2go" ? "POST" : "GET",
        headers: { ...auth(c), "Content-Type": "application/json" },
        ...(c.type === "smtp2go" ? { body: "{}" } : {}),
      },
      deps,
    );
    if (
      !response.ok &&
      normalizeError(response.status, JSON.stringify(data)).category ===
        "policy"
    )
      return verificationError(response.status, JSON.stringify(data));
    if (c.type === "resend" && obj(data).name === "invalid_api_key")
      return result(
        "AUTH_ERROR",
        false,
        check("Authentication", "failed", safeMessages.authentication),
      );
    if (
      c.type === "resend" &&
      (obj(data).name === "restricted_api_key" || response.status === 403)
    )
      return result(
        "UNVERIFIED",
        false,
        check(
          "Read permission",
          "unknown",
          "Domain read permission is unavailable; a sending-only key may still be valid.",
        ),
        check(
          "Send permission",
          "unknown",
          "Use Send Test Email for an explicit controlled test. Saving never sends an email.",
        ),
      );
    if (
      c.type === "sendgrid" &&
      response.status === 401 &&
      /authorization required|access forbidden/i.test(JSON.stringify(data))
    )
      return result(
        "MISSING_PERMISSION",
        false,
        check(
          "Read permission",
          "unknown",
          "The key cannot list scopes. This does not establish whether mail.send is granted; use a controlled test.",
        ),
      );
    if (!response.ok)
      return verificationError(response.status, JSON.stringify(data));
    if (strategy === "scopes") {
      const allowed = arr(obj(data).scopes).includes("mail.send");
      return result(
        allowed ? "HEALTHY" : "MISSING_PERMISSION",
        allowed,
        check("Authentication", "passed", "API key authenticated."),
        check(
          "mail.send",
          allowed ? "passed" : "failed",
          allowed
            ? "Sending permission is present."
            : "Add the mail.send scope.",
        ),
        check("Sender", "unknown", "Authenticate this sender in SendGrid."),
      );
    }
    if (strategy === "domains") {
      const domain = c.settings.domain ?? c.settings.fromEmail.split("@")[1];
      const found = arr(obj(data).data)
        .map(obj)
        .find((d) => d.name === domain);
      const ready = found?.status === "verified";
      return result(
        ready ? "HEALTHY" : "DOMAIN_UNVERIFIED",
        ready,
        check("Authentication", "passed", "API key authenticated."),
        check(
          "Domain",
          ready ? "passed" : "failed",
          ready
            ? "Sending domain verified."
            : "Sending domain is absent or unverified.",
        ),
      );
    }
    if (strategy === "server-stream") {
      if (obj(data).DeliveryType === "Sandbox")
        return result(
          "SANDBOX",
          false,
          check(
            "Server mode",
            "failed",
            "This Postmark server uses Sandbox delivery. Use a live Broadcast server for campaigns.",
          ),
        );
      const stream = await request(
        {
          url: ep.streamUrl!,
          method: "GET",
          headers: auth(c),
        },
        deps,
      );
      if (
        c.settings.messageStreamType === "transactional" ||
        !stream.response.ok ||
        obj(stream.data).MessageStreamType !== "Broadcast"
      )
        return result(
          "CONFIG_ERROR",
          false,
          check(
            "Message Stream",
            "failed",
            "Select an active Broadcast Message Stream.",
          ),
        );
      return result(
        "HEALTHY",
        true,
        check("Server token", "passed", "Supplied server token authenticated."),
        check("Message Stream", "passed", "Broadcast stream confirmed."),
        check("Sender", "unknown", "Verify your sender signature in Postmark."),
      );
    }
    if (c.type === "brevo" && path(data, "relay", "enabled") === false)
      return result(
        "CONFIG_ERROR",
        false,
        check("SMTP relay", "failed", "Enable transactional sending in Brevo."),
      );
    if (strategy === "account-sandbox") {
      const sandbox = await request(
        buildRequest(c, probe(c), {
          attemptId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          testMode: true,
        }),
        deps,
      );
      if (!sandbox.response.ok)
        return verificationError(
          sandbox.response.status,
          JSON.stringify(sandbox.data),
        );
      if (typeof obj(sandbox.data).messageId !== "string")
        return result(
          "DEGRADED",
          false,
          check(
            "Sandbox validation",
            "failed",
            "Brevo returned an unexpected validation response.",
          ),
        );
      return result(
        "UNVERIFIED",
        false,
        check("Authentication", "passed", "Account request authenticated."),
        check(
          "Sandbox format",
          "passed",
          "Request format validated without delivery.",
        ),
        check(
          "Send permission",
          "unknown",
          "Brevo sandbox validates format only. Use Send Test Email without sandbox mode to confirm sender acceptance.",
        ),
      );
    }
    return result(
      "UNVERIFIED",
      false,
      check("Authentication", "passed", "Read request authenticated."),
      check(
        "Send permission",
        "unknown",
        "Run Send Test Email to confirm sending permission and sender acceptance.",
      ),
    );
  } catch (error) {
    const e = obj(error);
    const status =
      typeof e.responseCode === "number"
        ? e.responseCode
        : Number(path(e, "$metadata", "httpStatusCode")) || undefined;
    if (status) {
      const n = normalizeError(
        status,
        String(e.message ?? ""),
        undefined,
        c.transport === "smtp" ? "smtp" : "http",
      );
      return result(
        n.category === "authentication"
          ? "AUTH_ERROR"
          : n.category === "authorization"
            ? "MISSING_PERMISSION"
            : n.category === "policy"
              ? "POLICY_BLOCKED"
              : "DEGRADED",
        false,
        check("Verification", "failed", n.message),
      );
    }
    return result(
      "DEGRADED",
      false,
      check(
        "Connectivity",
        "failed",
        "Could not complete verification. Check the connection and try again.",
      ),
    );
  }
}
function verificationError(status: number, detail: string) {
  const e = normalizeError(status, detail);
  return result(
    e.category === "authentication"
      ? "AUTH_ERROR"
      : e.category === "authorization"
        ? "MISSING_PERMISSION"
        : e.category === "policy"
          ? "POLICY_BLOCKED"
          : e.category === "sender_configuration"
            ? "SENDER_UNVERIFIED"
            : "DEGRADED",
    false,
    check(
      status === 403 ? "Read permission" : "Verification",
      "failed",
      status === 403
        ? "Read permission unavailable. This does not prove the sending key is invalid. Run a controlled test send."
        : e.message,
    ),
  );
}
