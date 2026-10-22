import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, tenants } from "@/db/schema";
import type { MemberRole } from "@/db/schema";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "./errors";

// ---------------------------------------------------------------------------
// THE authorization boundary. Every read and every write goes through
// authorize(). There is no second path to tenant data.
//
// The tenant the client asks for is only ever a REQUEST. It is resolved
// against the memberships table using the server-resolved user id before any
// domain query runs. A client that renames the tenant slug in the URL gets a
// 404, not another tenant's data.
// ---------------------------------------------------------------------------

const RANK: Record<MemberRole, number> = { viewer: 1, editor: 2, admin: 3 };

export type ActorContext = {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  role: MemberRole;
};

/**
 * @param userId  server-resolved identity, or null when unauthenticated.
 * @param tenantSlug  the tenant the CLIENT asked for. Untrusted.
 * @param minRole  least privileged role allowed to perform the action.
 */
export async function authorize(
  userId: string | null,
  tenantSlug: string,
  minRole: MemberRole,
): Promise<ActorContext> {
  // 1. No identity -> 401, before any tenant lookup. An unauthenticated
  //    caller must not be able to probe which tenant slugs exist.
  if (!userId) throw new UnauthenticatedError();

  // 2. Single joined lookup. A tenant that exists but that this user is not a
  //    member of produces no row, identically to a tenant that does not
  //    exist. Both become 404, so membership is not an oracle.
  const [row] = await db
    .select({
      tenantId: tenants.id,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, userId), eq(tenants.slug, tenantSlug)))
    .limit(1);

  if (!row) throw new NotFoundError();

  // 3. Member, but not privileged enough -> 403. Safe to distinguish here:
  //    they can already see this tenant, so the status leaks nothing.
  if (RANK[row.role] < RANK[minRole]) {
    throw new ForbiddenError(
      `Role "${row.role}" cannot perform this action; "${minRole}" or higher is required.`,
    );
  }

  return {
    userId,
    tenantId: row.tenantId,
    tenantSlug: row.tenantSlug,
    tenantName: row.tenantName,
    role: row.role,
  };
}

/** Tenants this user may actually see. Drives the tenant switcher. */
export async function membershipsFor(userId: string) {
  return db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId));
}

export function canWrite(role: MemberRole): boolean {
  return RANK[role] >= RANK.editor;
}
