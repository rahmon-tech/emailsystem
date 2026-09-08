import { Readable } from "node:stream";
import { parse } from "csv-parse";
import ExcelJS from "exceljs";
import { z } from "zod";
import { db } from "@emailsystem/db";
import { config } from "./config";
import { AppError } from "./errors";
import { json } from "./providers";
export interface ImportStats {
  rows: number;
  valid: number;
  invalid: number;
  duplicate: number;
  suppressed: number;
  sendable: number;
}
export function normalizeAddress(value: string) {
  const s = value.trim().toLowerCase();
  return z.email().safeParse(s).success ? s : null;
}
function validateZip(buffer: Buffer) {
  let total = 0,
    entries = 0;
  for (let i = 0; i < buffer.length - 46; i++) {
    if (buffer.readUInt32LE(i) !== 0x02014b50) continue;
    const compressed = buffer.readUInt32LE(i + 20),
      size = buffer.readUInt32LE(i + 24);
    total += size;
    entries++;
    if (
      size === 0xffffffff ||
      compressed === 0xffffffff ||
      total > 64000000 ||
      entries > 3000 ||
      size > Math.max(compressed * 200, 1000000)
    )
      throw new AppError(
        400,
        "XLSX_SIZE",
        "Spreadsheet expands beyond the allowed size. Export it as CSV.",
      );
    i += 45;
  }
  if (!entries) throw new AppError(400, "INVALID_XLSX", "Invalid XLSX file.");
}
async function* rows(
  buffer: Buffer,
  filename: string,
): AsyncGenerator<string[]> {
  if (filename.toLowerCase().endsWith(".xlsx")) {
    validateZip(buffer);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(
      Readable.from([buffer]),
      {
        entries: "emit",
        sharedStrings: "cache",
        hyperlinks: "ignore",
        styles: "ignore",
        worksheets: "emit",
      },
    );
    for await (const sheet of reader) {
      for await (const row of sheet) {
        const values = (
          Array.isArray(row.values)
            ? row.values.slice(1)
            : Object.values(row.values)
        ).map((v) =>
          typeof v === "object" && v !== null
            ? String("text" in v ? v.text : "result" in v ? v.result : "")
            : String(v ?? ""),
        );
        yield values;
      }
      break;
    }
    return;
  }
  if (!/\.(csv|txt)$/i.test(filename))
    throw new AppError(400, "FILE_TYPE", "Upload CSV, TXT or XLSX.");
  if (/\.txt$/i.test(filename)) {
    for (const line of buffer.toString("utf8").split(/\r?\n/)) {
      if (line.trim()) yield [line];
    }
    return;
  }
  const parser = Readable.from([buffer]).pipe(
    parse({
      bom: true,
      trim: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: 8192,
    }),
  );
  for await (const row of parser) yield row as string[];
}
export async function parseRecipients(
  buffer: Buffer,
  filename: string,
  maxRows: number,
) {
  const emails: string[] = [],
    seen = new Set<string>();
  const stats: ImportStats = {
    rows: 0,
    valid: 0,
    invalid: 0,
    duplicate: 0,
    suppressed: 0,
    sendable: 0,
  };
  let column: number | undefined;
  for await (const cells of rows(buffer, filename)) {
    if (column === undefined) {
      const header = cells.findIndex((v) =>
        /^(email|e-mail|email address|email_address)$/i.test(v.trim()),
      );
      if (header >= 0) {
        column = header;
        continue;
      }
      const detected = cells.findIndex((v) => normalizeAddress(v) !== null);
      column = detected >= 0 ? detected : 0;
    }
    stats.rows++;
    if (stats.rows > maxRows)
      throw new AppError(
        413,
        "ROW_LIMIT",
        `Maximum ${maxRows.toLocaleString()} rows per import.`,
      );
    const email = normalizeAddress(cells[column] ?? "");
    if (!email) {
      stats.invalid++;
      continue;
    }
    stats.valid++;
    if (seen.has(email)) {
      stats.duplicate++;
      continue;
    }
    seen.add(email);
    emails.push(email);
  }
  stats.sendable = emails.length;
  return { emails, stats };
}
export async function importRecipients(
  userId: string,
  buffer: Buffer,
  filename: string,
) {
  const cfg = config();
  if (buffer.length > cfg.MAX_UPLOAD_BYTES)
    throw new AppError(413, "UPLOAD_SIZE", "File exceeds the upload limit.");
  const parsed = await parseRecipients(buffer, filename, cfg.MAX_IMPORT_ROWS);
  const record = await db.contactImport.create({
    data: {
      userId,
      filename: filename.slice(0, 150),
      stats: json(parsed.stats),
    },
  });
  try {
    for (let i = 0; i < parsed.emails.length; i += 500) {
      const batch = parsed.emails.slice(i, i + 500);
      const suppressed = new Set(
        (
          await db.suppression.findMany({
            where: { userId, email: { in: batch } },
            select: { email: true },
          })
        ).map((r) => r.email),
      );
      parsed.stats.suppressed += suppressed.size;
      await db.importRecipient.createMany({
        data: batch
          .filter((email) => !suppressed.has(email))
          .map((email) => ({ importId: record.id, userId, email })),
        skipDuplicates: true,
      });
    }
    parsed.stats.sendable = parsed.emails.length - parsed.stats.suppressed;
    return await db.contactImport.update({
      where: { id: record.id },
      data: { state: "READY", stats: json(parsed.stats) },
    });
  } catch (error) {
    await db.contactImport.update({
      where: { id: record.id },
      data: { state: "FAILED" },
    });
    throw error;
  }
}
