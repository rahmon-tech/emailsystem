import { z } from "zod";
import { db } from "@emailsystem/db";
import { AppError } from "./errors";

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export const workspaceSettings = z
  .object({
    organizationName: z
      .string()
      .trim()
      .min(1, "Workspace name is required.")
      .max(100)
      .default("My workspace"),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(validTimeZone, "Use a valid IANA timezone such as Africa/Lagos.")
      .default("UTC"),
  })
  .strict();

export type WorkspaceSettings = z.infer<typeof workspaceSettings>;

export async function getWorkspaceSettings(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { workspaceSettings: true },
  });
  if (!user) throw new AppError(404, "NOT_FOUND", "Account not found.");
  return workspaceSettings.parse(user.workspaceSettings);
}

export async function saveWorkspaceSettings(
  userId: string,
  input: unknown,
) {
  const settings = workspaceSettings.parse(input);
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { workspaceSettings: settings },
    }),
    db.auditEvent.create({
      data: {
        userId,
        action: "workspace.settings.updated",
        resourceId: userId,
      },
    }),
  ]);
  return settings;
}
