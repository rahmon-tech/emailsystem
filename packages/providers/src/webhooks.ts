import {
  createHmac,
  createPublicKey,
  verify,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import type { Connection, ProviderType } from "./catalog";
import type { EventKind } from "@emailsystem/core/domain";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
const equal = (a: string, b: string) =>
  a.length > 0 &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const recent = (timestamp: string) =>
  Number.isFinite(Number(timestamp)) &&
  Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
export async function authenticateWebhook(
  c: Connection,
  raw: string,
  h: Headers,
  url: URL,
): Promise<boolean> {
  try {
    const secret = c.credentials.webhookSecret;
    if (c.type === "resend") {
      const id = h.get("svix-id") ?? "",
        time = h.get("svix-timestamp") ?? "",
        sigs = h.get("svix-signature") ?? "";
      if (!secret || !id || !recent(time)) return false;
      const sig = createHmac(
        "sha256",
        Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
      )
        .update(`${id}.${time}.${raw}`)
        .digest("base64");
      return sigs.split(" ").some((s) => equal(s, "v1," + sig));
    }
    if (c.type === "mailgun") {
      const signature = obj(obj(JSON.parse(raw)).signature);
      const time = text(signature.timestamp),
        token = text(signature.token);
      return (
        !!secret &&
        recent(time) &&
        equal(
          text(signature.signature),
          createHmac("sha256", secret)
            .update(time + token)
            .digest("hex"),
        )
      );
    }
    if (c.type === "sendgrid") {
      const time = h.get("x-twilio-email-event-webhook-timestamp") ?? "";
      if (!recent(time) || !c.credentials.webhookPublicKey) return false;
      const key = createPublicKey({
        key: Buffer.from(c.credentials.webhookPublicKey, "base64"),
        format: "der",
        type: "spki",
      });
      return verify(
        "sha256",
        Buffer.from(time + raw),
        key,
        Buffer.from(
          h.get("x-twilio-email-event-webhook-signature") ?? "",
          "base64",
        ),
      );
    }
    if (c.type === "ses") return authenticateSns(c, obj(JSON.parse(raw)));
    if (c.type === "elastic")
      return !!secret && equal(url.searchParams.get("key") ?? "", secret);
    return (
      !!secret &&
      equal(
        h.get("authorization") ?? "",
        "Basic " + Buffer.from("emailsystem:" + secret).toString("base64"),
      )
    );
  } catch {
    return false;
  }
}
async function authenticateSns(c: Connection, data: Obj) {
  const region = c.settings.region ?? "us-east-1";
  const host = `sns.${region}.amazonaws.com`;
  if (
    !c.credentials.snsTopicArn ||
    data.TopicArn !== c.credentials.snsTopicArn ||
    ![
      "Notification",
      "SubscriptionConfirmation",
      "UnsubscribeConfirmation",
    ].includes(text(data.Type))
  )
    return false;
  const url = new URL(text(data.SigningCertURL));
  if (
    url.protocol !== "https:" ||
    url.hostname !== host ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    !/^\/SimpleNotificationService-[a-zA-Z0-9-]+\.pem$/.test(url.pathname)
  )
    return false;
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return false;
  const certificate = await response.text();
  if (certificate.length > 20000) return false;
  const keys =
    data.Type === "Notification"
      ? [
          "Message",
          "MessageId",
          ...(data.Subject ? ["Subject"] : []),
          "Timestamp",
          "TopicArn",
          "Type",
        ]
      : [
          "Message",
          "MessageId",
          "SubscribeURL",
          "Timestamp",
          "Token",
          "TopicArn",
          "Type",
        ];
  if (keys.some((k) => typeof data[k] !== "string")) return false;
  const canonical = keys.map((k) => k + "\n" + text(data[k]) + "\n").join("");
  const algorithm =
    data.SignatureVersion === "2"
      ? "RSA-SHA256"
      : data.SignatureVersion === "1"
        ? "RSA-SHA1"
        : null;
  if (!algorithm) return false;
  if (
    !verify(
      algorithm,
      Buffer.from(canonical),
      certificate,
      Buffer.from(text(data.Signature), "base64"),
    )
  )
    return false;
  if (data.Type === "SubscriptionConfirmation") {
    const confirm = new URL(text(data.SubscribeURL));
    if (
      confirm.protocol !== "https:" ||
      confirm.hostname !== host ||
      confirm.port ||
      confirm.username ||
      confirm.password ||
      confirm.pathname !== "/" ||
      confirm.searchParams.get("Action") !== "ConfirmSubscription" ||
      confirm.searchParams.get("TopicArn") !== c.credentials.snsTopicArn ||
      confirm.searchParams.get("Token") !== data.Token
    )
      return false;
    const accepted = await fetch(confirm, {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!accepted.ok) return false;
  }
  return true;
}
export interface NormalizedEvent {
  eventKey: string;
  messageId: string;
  recipient?: string;
  attemptId?: string;
  kind: EventKind;
  occurredAt: Date;
}
export function normalizeWebhook(
  type: ProviderType,
  payload: unknown,
  requestId: string,
): NormalizedEvent[] {
  const output: NormalizedEvent[] = [];
  let entries = Array.isArray(payload) ? payload : [payload];
  if (type === "ses") {
    const outer = obj(payload);
    if (outer.Type !== "Notification") return [];
    entries = [JSON.parse(text(outer.Message))];
    requestId = text(outer.MessageId);
  }
  for (const value of entries) {
    const event = obj(value);
    let name = "",
      id = "",
      recipient = "",
      eventId = "",
      attempt = "",
      stamp: unknown;
    let bounceType = "";
    let eventRecipients: string[] = [];
    if (type === "resend") {
      const d = obj(event.data);
      name = text(event.type).replace("email.", "");
      id = text(d.email_id);
      recipient = text(list(d.to)[0]);
      eventId = requestId;
      stamp = event.created_at;
      attempt = text(obj(d.tags).attempt);
    } else if (type === "mailgun") {
      const e = obj(event["event-data"]);
      name = text(e.event);
      if (name === "failed")
        name = e.severity === "permanent" ? "hard_bounce" : "soft_bounce";
      id = text(obj(obj(e.message).headers)["message-id"]);
      recipient = text(e.recipient);
      eventId = text(e.id);
      stamp = e.timestamp;
      attempt = text(obj(e["user-variables"]).es_attempt);
    } else if (type === "sendgrid") {
      name = text(event.event);
      id = text(event.sg_message_id).split(".filter")[0];
      recipient = text(event.email);
      eventId = text(event.sg_event_id);
      attempt = text(event.es_attempt);
      stamp = event.timestamp;
      bounceType = /^5/.test(text(event.status)) ? "hard" : text(event.type);
    } else if (type === "postmark") {
      name = text(event.RecordType).toLowerCase();
      id = text(event.MessageID);
      recipient = text(event.Recipient ?? event.Email);
      eventId = text(event.ID);
      attempt = text(obj(event.Metadata).es_attempt);
      stamp = event.DeliveredAt ?? event.BouncedAt ?? event.ReceivedAt;
      bounceType = text(event.Type);
    } else if (type === "mailjet") {
      name = text(event.event);
      id = text(event.Message_GUID ?? event.MessageUUID ?? event.MessageID);
      recipient = text(event.email);
      eventId = "";
      attempt = text(event.CustomID);
      stamp = event.time;
      bounceType = event.hard_bounce === true ? "hard" : "soft";
    } else if (type === "smtp2go") {
      name = text(event.event);
      id = text(event.email_id);
      recipient = text(event.rcpt);
      eventId = text(event.id);
      stamp = event.time;
      bounceType = text(event.bounce);
    } else if (type === "brevo") {
      name = text(event.event);
      id = text(event["message-id"]);
      recipient = text(event.email);
      eventId = text(event.id);
      stamp = event.ts_event ?? event.ts;
    } else if (type === "elastic") {
      name = text(event.status).toLowerCase();
      id = text(event.messageid);
      recipient = text(event.to);
      stamp = event.date;
      bounceType = text(event.category) === "NoMailbox" ? "hard" : "soft";
    } else if (type === "ses") {
      name = text(event.eventType ?? event.notificationType).toLowerCase();
      id = text(obj(event.mail).messageId);
      eventId = requestId;
      attempt = text(list(obj(obj(event.mail).tags).es_attempt)[0]);
      stamp = obj(event.mail).timestamp;
      bounceType =
        text(obj(event.bounce).bounceType) === "Permanent" ? "hard" : "soft";
      const recipients = list(obj(event.bounce).bouncedRecipients).concat(
        list(obj(event.complaint).complainedRecipients),
      );
      eventRecipients = recipients.length
        ? recipients.map((r) => text(obj(r).emailAddress))
        : list(obj(event.delivery).recipients).length
          ? list(obj(event.delivery).recipients).map(text)
          : list(obj(event.mail).destination).map(text);
      recipient = text(
        obj(recipients[0]).emailAddress ??
          list(obj(event.delivery).recipients)[0] ??
          list(obj(event.mail).destination)[0],
      );
    } else if (type === "mock") {
      name = text(event.event);
      id = text(event.messageId);
      recipient = text(event.email);
      eventId = text(event.id);
      attempt = text(event.attemptId);
      stamp = event.timestamp;
    } else if (type === "smtp") {
      name = text(event.event ?? event.status).toLowerCase();
      id = text(
        event.messageId ??
          event.message_id ??
          event["message-id"] ??
          event.id,
      );
      recipient = text(event.recipient ?? event.email ?? event.to);
      eventId = text(event.eventId ?? event.event_id ?? event.id);
      attempt = text(event.attemptId ?? event.attempt_id ?? event.es_attempt);
      stamp = event.timestamp ?? event.time ?? event.date;
      bounceType = text(event.bounceType ?? event.bounce_type ?? event.category);
    }
    const rfcId =
      type === "ses"
        ? text(obj(obj(event.mail).commonHeaders).messageId) ||
          text(
            obj(
              list(obj(event.mail).headers).find(
                (h) => text(obj(h).name).toLowerCase() === "message-id",
              ),
            ).value,
          )
        : text(event["message-id"]) || id;
    attempt ||=
      rfcId.match(
        /^<?([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})@[^>\s]+>?$/i,
      )?.[1] ?? "";
    const map: Record<string, EventKind> = {
      sent: type === "elastic" || type === "mailjet" ? "delivered" : "accepted",
      send: "accepted",
      processed: "accepted",
      accepted: "accepted",
      delivered: "delivered",
      delivery: "delivered",
      delivery_delayed: "deferred",
      deferred: "deferred",
      soft_bounce: "soft_bounce",
      softbounce: "soft_bounce",
      hard_bounce: "hard_bounce",
      hardbounce: "hard_bounce",
      bounced: "hard_bounce",
      complained: "complaint",
      complaint: "complaint",
      spamcomplaint: "complaint",
      spamreport: "complaint",
      spam: "complaint",
      abuseReport: "complaint",
      abusereport: "complaint",
      unsubscribe: "unsubscribe",
      unsub: "unsubscribe",
      unsubscribed: "unsubscribe",
      subscriptionchange: "unsubscribe",
      opened: "open",
      open: "open",
      click: "click",
      clicked: "click",
      error: bounceType === "hard" ? "hard_bounce" : "soft_bounce",
      bounce: /hard|permanent/i.test(bounceType)
        ? "hard_bounce"
        : "soft_bounce",
    };
    const kind = map[name];
    if (!kind || !id) continue;
    const occurredAt =
      typeof stamp === "number"
        ? new Date(stamp * 1000)
        : new Date(typeof stamp === "string" ? stamp : Date.now());
    if (Number.isNaN(occurredAt.getTime())) continue;
    const key =
      eventId ||
      createHash("sha256")
        .update([type, id, recipient, name, text(stamp)].join("|"))
        .digest("hex");
    for (const address of eventRecipients.length
      ? [...new Set(eventRecipients)]
      : [recipient])
      output.push({
        eventKey: eventRecipients.length
          ? key + ":" + address.toLowerCase()
          : key,
        messageId: id,
        recipient: address ? address.toLowerCase() : undefined,
        attemptId: attempt || undefined,
        kind,
        occurredAt,
      });
  }
  return output;
}
