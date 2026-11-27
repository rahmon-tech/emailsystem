import { z } from "zod";
import { db } from "@emailsystem/db";
import { assertSameOrigin, requireUser } from "@emailsystem/core/auth";
import { AppError } from "@emailsystem/core/errors";
import { errorResponse, response } from "@emailsystem/core/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const id = z.uuid().parse((await params).id);
    const existing = await db.contactImport.findFirst({
      where: {
        id,
        userId: user.id,
        state: "READY",
        kind: "LIST_IMPORT",
      },
      select: { id: true },
    });
    if (!existing)
      throw new AppError(404, "NOT_FOUND", "Saved recipient list not found.");
    await db.$transaction(async (tx) => {
      await tx.contactImport.update({
        where: { id },
        data: { state: "ARCHIVED" },
      });
      // Imported reusable lists share their ID with the editable Audience list.
      // Removing the saved list drops membership only; canonical contacts and
      // historical campaign snapshots remain intact.
      await tx.audienceList.deleteMany({
        where: { id, userId: user.id },
      });
      await tx.auditEvent.create({
        data: {
          userId: user.id,
          action: "import.archived",
          resourceId: id,
        },
      });
    });
    return response({ removed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
