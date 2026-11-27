import { after, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "@emailsystem/db";
import { importRecipients } from "@emailsystem/core/imports";
import {
  listContacts,
  listAudienceLists,
  saveContact,
  snapshotAudienceList,
} from "@emailsystem/core/audience";

const users: string[] = [];

after(async () => {
  if (users.length) await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

test("audience lists stay editable while campaign snapshots remain immutable", async () => {
  const user = await db.user.create({
    data: {
      email: crypto.randomUUID() + "@example.com",
      passwordHash: "test-only",
    },
  });
  users.push(user.id);

  const original = await importRecipients(
    user.id,
    Buffer.from(
      "email\none@example.net\ntwo@example.net\nthree@example.net\n",
    ),
    "Customers.csv",
  );
  const lists = await listAudienceLists(user.id);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].id, original.id);
  assert.equal(lists[0].name, "Customers.csv");
  assert.equal(lists[0]._count.memberships, 3);

  const contacts = await listContacts(user.id);
  assert.equal(contacts.summary.activeContacts, 3);
  assert.equal(contacts.summary.savedLists, 1);
  assert.deepEqual(
    contacts.items.map((item) => item.email).sort(),
    ["one@example.net", "three@example.net", "two@example.net"],
  );

  await db.suppression.create({
    data: {
      userId: user.id,
      email: "two@example.net",
      reason: "manual",
    },
  });
  const suppressedView = await listContacts(user.id, { search: "two@" });
  assert.equal(suppressedView.items[0]?.status, "SUPPRESSED");

  const firstSnapshot = await snapshotAudienceList(user.id, lists[0].id);
  assert.equal(firstSnapshot.kind, "CAMPAIGN_SNAPSHOT");
  assert.equal(original.kind, "LIST_IMPORT");
  assert.equal((firstSnapshot.stats as Record<string, number>).sendable, 2);
  assert.equal(
    await db.importRecipient.count({ where: { importId: firstSnapshot.id } }),
    2,
  );
  assert.equal(
    await db.importRecipient.count({ where: { importId: original.id } }),
    3,
    "Creating a campaign snapshot must not rewrite the original saved import.",
  );

  await saveContact(user.id, {
    email: "manual@example.net",
    firstName: "Manual",
    listId: lists[0].id,
  });
  assert.equal(
    (await listAudienceLists(user.id))[0]._count.memberships,
    4,
  );

  const secondSnapshot = await snapshotAudienceList(user.id, lists[0].id);
  assert.equal((secondSnapshot.stats as Record<string, number>).sendable, 3);
  assert.equal(
    await db.importRecipient.count({ where: { importId: secondSnapshot.id } }),
    3,
  );
  assert.equal(
    await db.importRecipient.count({ where: { importId: firstSnapshot.id } }),
    2,
    "An older campaign snapshot must stay unchanged after the audience list changes.",
  );
});
