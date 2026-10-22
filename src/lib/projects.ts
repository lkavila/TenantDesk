import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLogs, projects } from "@/db/schema";
import { authorize } from "./authz";
import { NotFoundError, ValidationError } from "./errors";

export const projectNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters.")
  .max(80, "Name must be 80 characters or fewer.")
  .regex(
    /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u,
    "Use letters, numbers, spaces, dots, underscores or hyphens.",
  );

function parseName(raw: unknown): string {
  const result = projectNameSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError({
      name: result.error.issues[0]?.message ?? "Invalid name.",
    });
  }
  return result.data;
}

// Postgres unique-violation -> a field error the form can render, instead of a
// 500. The tenant-aware unique index on (tenant_id, name) is the source of
// truth for duplicates; pre-checking in JS would be a race.
function mapDbError(e: unknown): never {
  // Drizzle wraps driver errors in DrizzleQueryError, so the Postgres
  // SQLSTATE can be one level down in `cause`. Check both.
  const code =
    (e as { code?: string })?.code ??
    (e as { cause?: { code?: string } })?.cause?.code;

  if (code === "23505") {
    throw new ValidationError({
      name: "A project with that name already exists in this tenant.",
    });
  }
  throw e as Error;
}

export async function listProjects(userId: string | null, tenantSlug: string) {
  const ctx = await authorize(userId, tenantSlug, "viewer");
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.tenantId, ctx.tenantId))
    .orderBy(desc(projects.createdAt));
  return { ctx, rows };
}

export async function createProject(
  userId: string | null,
  tenantSlug: string,
  rawName: unknown,
) {
  // Authorize first, validate second. A viewer sending a malformed name must
  // get 403, not 422: the status must not reveal that their role passed.
  const ctx = await authorize(userId, tenantSlug, "editor");
  const name = parseName(rawName);

  // The insert and its audit entry are one transaction. If the audit insert
  // fails, the project insert rolls back. There is no state where a project
  // exists without the entry recording who created it.
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(projects)
        .values({ tenantId: ctx.tenantId, name, createdBy: ctx.userId })
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "project.create",
        entityType: "project",
        entityId: created.id,
        metadata: { name },
      });

      return created;
    });
  } catch (e) {
    mapDbError(e);
  }
}

export async function renameProject(
  userId: string | null,
  tenantSlug: string,
  projectId: string,
  rawName: unknown,
) {
  const ctx = await authorize(userId, tenantSlug, "editor");
  const name = parseName(rawName);

  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(projects)
        // Scoped by id AND tenant_id. Second line of defense: even if
        // authorize() were bypassed, a project id owned by another tenant
        // matches no row here.
        .where(
          and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenantId)),
        )
        .limit(1);

      if (!before) throw new NotFoundError();

      const [updated] = await tx
        .update(projects)
        .set({ name, updatedAt: new Date() })
        .where(
          and(eq(projects.id, projectId), eq(projects.tenantId, ctx.tenantId)),
        )
        .returning();

      await tx.insert(auditLogs).values({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "project.rename",
        entityType: "project",
        entityId: projectId,
        metadata: { from: before.name, to: name },
      });

      return updated;
    });
  } catch (e) {
    mapDbError(e);
  }
}
