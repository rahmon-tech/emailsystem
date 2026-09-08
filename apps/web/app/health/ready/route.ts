import { db } from "@emailsystem/db";
import { redis } from "@emailsystem/core/redis";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await Promise.race([
      Promise.all([db.$queryRaw`SELECT 1`, redis.ping()]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 3000),
      ),
    ]);
    const worker = await redis.get("worker:heartbeat");
    return Response.json(
      { status: worker ? "ready" : "worker_unavailable" },
      { status: worker ? 200 : 503 },
    );
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
