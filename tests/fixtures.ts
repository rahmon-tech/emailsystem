import type { Connection } from "../packages/providers/src/index";
export function connection(type: Connection["type"]): Connection {
  return {
    id: "p1",
    name: "Primary",
    type,
    transport: type === "smtp" ? "smtp" : "api",
    settings: {
      fromEmail: "sender@example.com",
      fromName: "Sender",
      replyTo: "",
      domain: "example.com",
      messageStream: "broadcast",
      timeout: 20000,
      mockMode: "success",
      ...(type === "smtp" ? { host: "smtp.example.com" } : {}),
    },
    credentials: {
      apiKey: "key-secret",
      secretKey: "secret-secret",
      serverToken: "token-secret",
      accessKeyId: "aws-key",
      secretAccessKey: "aws-secret",
      username: "smtp-user",
      password: "smtp-secret",
    },
    weight: 1,
    perSecond: 1,
    perMinute: 30,
    concurrency: 1,
  };
}
