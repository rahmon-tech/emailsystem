import "dotenv/config";
import { defineConfig } from "prisma/config";
export default defineConfig({
  schema: "packages/db/schema.prisma",
  migrations: { path: "packages/db/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/emailsystem",
  },
});
