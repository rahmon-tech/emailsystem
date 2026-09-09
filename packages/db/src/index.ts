import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
export type { Prisma } from "../generated/client";
export type { TrackingDomain } from "../generated/client";
export { CampaignState, DeliveryState } from "../generated/enums";
const globalDb = globalThis as unknown as { emailDb?: PrismaClient };
export const db =
  globalDb.emailDb ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      max: 10,
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.emailDb = db;
