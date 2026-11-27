import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import {
  changePassword,
  createUser,
} from "@emailsystem/core/auth";
import {
  getWorkspaceSettings,
  saveWorkspaceSettings,
} from "@emailsystem/core/workspace-settings";
import { checkPassword } from "@emailsystem/core/security";
import { AppError } from "@emailsystem/core/errors";
import { redis } from "@emailsystem/core/redis";

const users: string[] = [];

after(async () => {
  if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
  for (const id of users)
    await redis.del(
      "password-change:user:" +
        (await import("@emailsystem/core/security")).digest(id),
    );
  await db.$disconnect();
  await redis.quit();
});

test("workspace settings default safely and validate timezone changes", async () => {
  const user = await createUser(
    crypto.randomUUID() + "@example.com",
    "Original-password-2026",
  );
  users.push(user.id);

  assert.deepEqual(await getWorkspaceSettings(user.id), {
    organizationName: "My workspace",
    timezone: "UTC",
  });

  assert.deepEqual(
    await saveWorkspaceSettings(user.id, {
      organizationName: "Rahmontech Campaigns",
      timezone: "Africa/Lagos",
    }),
    {
      organizationName: "Rahmontech Campaigns",
      timezone: "Africa/Lagos",
    },
  );
  assert.deepEqual(await getWorkspaceSettings(user.id), {
    organizationName: "Rahmontech Campaigns",
    timezone: "Africa/Lagos",
  });
  await assert.rejects(() =>
    saveWorkspaceSettings(user.id, {
      organizationName: "Broken timezone",
      timezone: "Not/A-Timezone",
    }),
  );
  assert.equal(
    await db.auditEvent.count({
      where: {
        userId: user.id,
        action: "workspace.settings.updated",
      },
    }),
    1,
  );
});

test("password change verifies the old password, rotates the hash and invalidates sessions", async () => {
  const original = "Original-password-2026";
  const next = "Replacement-password-2026";
  const user = await createUser(
    crypto.randomUUID() + "@example.com",
    original,
  );
  users.push(user.id);

  await db.session.createMany({
    data: [
      {
        tokenHash: crypto.randomUUID(),
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      },
      {
        tokenHash: crypto.randomUUID(),
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      },
    ],
  });

  await assert.rejects(
    () => changePassword(user.id, "Wrong-password-2026", next),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === "INVALID_PASSWORD",
  );
  assert.equal(
    await db.session.count({ where: { userId: user.id } }),
    2,
  );

  await changePassword(user.id, original, next);
  const changed = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  assert.equal(await checkPassword(next, changed.passwordHash), true);
  assert.equal(await checkPassword(original, changed.passwordHash), false);
  assert.equal(
    await db.session.count({ where: { userId: user.id } }),
    0,
  );
  assert.equal(
    await db.auditEvent.count({
      where: {
        userId: user.id,
        action: "account.password_changed",
      },
    }),
    1,
  );
});
