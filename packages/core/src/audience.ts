import { z } from "zod";
import { db } from "@emailsystem/db";
import { AppError } from "./errors";
import { normalizeAddress } from "./imports";

const contactInput = z
  .object({
    email: z.string().max(254),
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
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
    db.contactImport.count({ where: { userId, state: "READY" } }),
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
  const existing = await db.contact.findUnique({
    where: { userId_email: { userId, email } },
  });
  const contact = existing
    ? await db.contact.update({
        where: { id: existing.id },
        data: {
          ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
          ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
          archivedAt: null,
        },
      })
    : await db.contact.create({
        data: {
          userId,
          email,
          firstName: data.firstName ?? "",
          lastName: data.lastName ?? "",
          source: "manual",
        },
      });
  return contactStatus(userId, contact);
}

export async function updateContact(
  userId: string,
  id: string,
  input: unknown,
) {
  const data = contactUpdate.parse(input);
  const contact = await db.contact.findFirst({
    where: { id, userId },
  });
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
