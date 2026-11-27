import { z } from "zod";
import { db } from "@emailsystem/db";
import { AppError } from "./errors";
import { normalizeAddress } from "./imports";
import { json } from "./providers";

const contactInput = z
  .object({
    email: z.string().max(254),
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    listId: z.uuid().optional(),
  })
  .strict();

const contactUpdate = z
  .object({
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.firstName !== undefined ||
      value.lastName !== undefined ||
      value.archived !== undefined,
    { message: "Choose a contact field to update." },
  );

const listInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
  })
  .strict();

const listUpdate = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    { message: "Choose a list field to update." },
  );

async function contactStatus(
  userId: string,
  contact: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    source: string;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
) {
  const suppression = await db.suppression.findUnique({
    where: { userId_email: { userId, email: contact.email } },
    select: { reason: true, createdAt: true },
  });
  return {
    ...contact,
    status: contact.archivedAt
      ? ("ARCHIVED" as const)
      : suppression
        ? ("SUPPRESSED" as const)
        : ("ACTIVE" as const),
    suppressionReason: suppression?.reason ?? null,
    suppressedAt: suppression?.createdAt ?? null,
  };
}

export async function listContacts(
  userId: string,
  options: { search?: string; cursor?: string } = {},
) {
  const search = options.search?.trim().slice(0, 254) ?? "";
  if (
    options.cursor &&
    !(await db.contact.findFirst({
      where: { id: options.cursor, userId },
      select: { id: true },
    }))
  )
    throw new AppError(400, "CURSOR", "Invalid contact page cursor.");

  const where = {
    userId,
    archivedAt: null,
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" as const } },
            { firstName: { contains: search, mode: "insensitive" as const } },
            { lastName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [rows, activeContacts, savedLists, suppressions] = await Promise.all([
    db.contact.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        source: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    db.contact.count({ where: { userId, archivedAt: null } }),
    db.audienceList.count({ where: { userId } }),
    db.suppression.count({ where: { userId } }),
  ]);
  const items = rows.slice(0, 50);
  const suppressed = new Map(
    (
      await db.suppression.findMany({
        where: { userId, email: { in: items.map((item) => item.email) } },
        select: { email: true, reason: true, createdAt: true },
      })
    ).map((item) => [item.email, item]),
  );
  return {
    items: items.map((contact) => {
      const suppression = suppressed.get(contact.email);
      return {
        ...contact,
        status: suppression ? ("SUPPRESSED" as const) : ("ACTIVE" as const),
        suppressionReason: suppression?.reason ?? null,
        suppressedAt: suppression?.createdAt ?? null,
      };
    }),
    nextCursor: rows.length > 50 ? rows[49].id : null,
    summary: { activeContacts, savedLists, suppressions },
  };
}

export async function saveContact(userId: string, input: unknown) {
  const data = contactInput.parse(input);
  const email = normalizeAddress(data.email);
  if (!email) throw new AppError(400, "EMAIL", "Enter a valid email address.");

  const contact = await db.$transaction(async (tx) => {
    if (
      data.listId &&
      !(await tx.audienceList.findFirst({
        where: { id: data.listId, userId },
        select: { id: true },
      }))
    )
      throw new AppError(404, "LIST", "Audience list not found.");

    const existing = await tx.contact.findUnique({
      where: { userId_email: { userId, email } },
    });
    const saved = existing
      ? await tx.contact.update({
          where: { id: existing.id },
          data: {
            ...(data.firstName !== undefined
              ? { firstName: data.firstName }
              : {}),
            ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
            archivedAt: null,
          },
        })
      : await tx.contact.create({
          data: {
            userId,
            email,
            firstName: data.firstName ?? "",
            lastName: data.lastName ?? "",
            source: "manual",
          },
        });
    if (data.listId)
      await tx.audienceMembership.upsert({
        where: {
          listId_contactId: { listId: data.listId, contactId: saved.id },
        },
        create: { userId, listId: data.listId, contactId: saved.id },
        update: {},
      });
    return saved;
  });
  return contactStatus(userId, contact);
}

export async function updateContact(
  userId: string,
  id: string,
  input: unknown,
) {
  const data = contactUpdate.parse(input);
  const contact = await db.contact.findFirst({ where: { id, userId } });
  if (!contact) throw new AppError(404, "NOT_FOUND", "Contact not found.");
  const updated = await db.contact.update({
    where: { id },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
      ...(data.archived !== undefined
        ? { archivedAt: data.archived ? new Date() : null }
        : {}),
    },
  });
  return contactStatus(userId, updated);
}

export async function listAudienceLists(userId: string) {
  return db.audienceList.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { memberships: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
  });
}

export async function createAudienceList(userId: string, input: unknown) {
  const data = listInput.parse(input);
  return db.audienceList.create({ data: { userId, ...data } });
}

export async function updateAudienceList(
  userId: string,
  id: string,
  input: unknown,
) {
  const data = listUpdate.parse(input);
  if (!(await db.audienceList.count({ where: { id, userId } })))
    throw new AppError(404, "NOT_FOUND", "Audience list not found.");
  return db.audienceList.update({ where: { id }, data });
}

export async function snapshotAudienceList(userId: string, id: string) {
  return db.$transaction(
    async (tx) => {
      const list = await tx.audienceList.findFirst({
        where: { id, userId },
        select: { id: true, name: true },
      });
      if (!list) throw new AppError(404, "NOT_FOUND", "Audience list not found.");

      const [counts] = await tx.$queryRaw<
        { total: bigint; sendable: bigint }[]
      >`
        SELECT
          count(*) AS total,
          count(*) FILTER (
            WHERE c."archivedAt" IS NULL AND s.id IS NULL
          ) AS sendable
        FROM "AudienceMembership" m
        JOIN "Contact" c
          ON c.id=m."contactId" AND c."userId"=m."userId"
        LEFT JOIN "Suppression" s
          ON s."userId"=c."userId" AND s.email=c.email
        WHERE m."userId"=${userId} AND m."listId"=${id}
      `;
      const total = Number(counts.total);
      const sendable = Number(counts.sendable);
      if (!sendable)
        throw new AppError(
          422,
          "EMPTY_LIST",
          "This list has no active, sendable contacts.",
        );

      const stats = {
        rows: total,
        valid: total,
        invalid: 0,
        duplicate: 0,
        suppressed: total - sendable,
        sendable,
      };
      const snapshot = await tx.contactImport.create({
        data: {
          userId,
          filename: list.name.slice(0, 150),
          kind: "CAMPAIGN_SNAPSHOT",
          state: "PREPARING",
          stats: json(stats),
        },
      });
      await tx.$executeRaw`
        INSERT INTO "ImportRecipient" ("id","importId","userId","email")
        SELECT
          gen_random_uuid()::text,
          ${snapshot.id},
          c."userId",
          c.email
        FROM "AudienceMembership" m
        JOIN "Contact" c
          ON c.id=m."contactId" AND c."userId"=m."userId"
        LEFT JOIN "Suppression" s
          ON s."userId"=c."userId" AND s.email=c.email
        WHERE m."userId"=${userId}
          AND m."listId"=${id}
          AND c."archivedAt" IS NULL
          AND s.id IS NULL
        ON CONFLICT ("importId","email") DO NOTHING
      `;
      return tx.contactImport.update({
        where: { id: snapshot.id },
        data: { state: "READY", stats: json(stats) },
      });
    },
    { timeout: 60000 },
  );
}

export async function addContactToList(
  userId: string,
  listId: string,
  contactId: string,
) {
  return db.$transaction(async (tx) => {
    const [list, contact] = await Promise.all([
      tx.audienceList.findFirst({
        where: { id: listId, userId },
        select: { id: true },
      }),
      tx.contact.findFirst({
        where: { id: contactId, userId, archivedAt: null },
        select: { id: true },
      }),
    ]);
    if (!list) throw new AppError(404, "LIST", "Audience list not found.");
    if (!contact) throw new AppError(404, "CONTACT", "Contact not found.");
    return tx.audienceMembership.upsert({
      where: { listId_contactId: { listId, contactId } },
      create: { userId, listId, contactId },
      update: {},
    });
  });
}

export async function removeContactFromList(
  userId: string,
  listId: string,
  contactId: string,
) {
  const result = await db.audienceMembership.deleteMany({
    where: { userId, listId, contactId },
  });
  if (!result.count)
    throw new AppError(404, "MEMBERSHIP", "Contact is not in this list.");
  return { removed: true };
}
