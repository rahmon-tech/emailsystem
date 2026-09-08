// Test harness only. This file is never imported by the application.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:https";
import { request } from "node:http";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { createUser } from "@emailsystem/core/auth";
import { db } from "@emailsystem/db";
if (
  process.env.ALLOW_MOCK_PROVIDER !== "true" ||
  !process.env.DATABASE_URL?.includes("test")
)
  throw new Error(
    "E2E requires an isolated test database and explicitly enabled mock provider.",
  );
const email = "browser-test@example.com",
  password = "Isolated-browser-test-password-2026";
if (!(await db.user.findUnique({ where: { email } })))
  await createUser(email, password);
await db.$disconnect();
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "/tmp/emailsystem-e2e.key",
    "-out",
    "/tmp/emailsystem-e2e.crt",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
  ],
  { stdio: "ignore" },
);
let stopping = false;
const webLog = createWriteStream("/tmp/emailsystem-e2e-web.log");
const web = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "start", "apps/web", "--port", "3000"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
web.stdout.pipe(webLog);
web.stderr.pipe(webLog);
const workerLog = createWriteStream("/tmp/emailsystem-e2e-worker.log");
function startWorker() {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "apps/worker/main.ts"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(workerLog, { end: false });
  child.stderr.pipe(workerLog, { end: false });
  writeFileSync("/tmp/emailsystem-e2e-worker.pid", String(child.pid));
  child.on("exit", () => {
    if (!stopping) worker = startWorker();
  });
  return child;
}
let worker = startWorker();
const proxy = createServer(
  {
    key: readFileSync("/tmp/emailsystem-e2e.key"),
    cert: readFileSync("/tmp/emailsystem-e2e.crt"),
  },
  (req, res) => {
    const upstream = request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          "x-real-ip": req.socket.remoteAddress ?? "127.0.0.1",
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(503);
      res.end("Starting");
    });
    req.pipe(upstream);
    res.on("close", () => upstream.destroy());
  },
);
proxy.listen(3443, "127.0.0.1");
function stop() {
  if (stopping) return;
  stopping = true;
  worker.kill("SIGTERM");
  web.kill("SIGTERM");
  proxy.close();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
