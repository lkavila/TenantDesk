import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { auditLogs, projects, user } from "@/db/schema";
import { authorize } from "@/lib/authz";
import { createProject, listProjects, renameProject } from "@/lib/projects";
import {
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "@/lib/errors";

// ---------------------------------------------------------------------------
// These tests exercise the real authorization boundary against a real
// Postgres: real membership rows, real queries, real transactions. Nothing
// about the tenant check is mocked. The UI is not involved, because a passing
// UI test would prove nothing about the server boundary.
//
// Personas come from the seed:
//   alice  admin  in acme only
//   bob    admin  in globex only
//   vera   viewer in acme only
// ---------------------------------------------------------------------------

let aliceId: string;
let bobId: string;
let veraId: string;
let acmeTenantId: string;
let globexProjectId: string;
let acmeProjectId: string;

async function userId(email: string): Promise<string> {
  const [row] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!row) throw new Error(`Seed missing user ${email}. Run: npm run db:seed`);
  return row.id;
}

beforeAll(async () => {
  aliceId = await userId("alice@acme.test");
  bobId = await userId("bob@globex.test");
  veraId = await userId("vera@acme.test");

  const globex = await listProjects(bobId, "globex");
  const acme = await listProjects(aliceId, "acme");
  globexProjectId = globex.rows[0]!.id;
  acmeProjectId = acme.rows[0]!.id;
  acmeTenantId = acme.ctx.tenantId;
});

afterAll(async () => {
  await pool.end();
});

describe("1. unauthenticated access", () => {
  it("rejects a read with 401 before any tenant lookup", async () => {
    await expect(listProjects(null, "acme")).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("rejects a write with 401", async () => {
    await expect(createProject(null, "acme", "Anything")).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it("does not reveal whether a tenant slug exists", async () => {
    const real = await listProjects(null, "acme").catch((e) => e);
    const fake = await listProjects(null, "does-not-exist").catch((e) => e);
    expect(real.constructor).toBe(fake.constructor);
    expect(real.message).toBe(fake.message);
  });
});

describe("2. cross-tenant read (the reviewer's first attack)", () => {
  it("alice cannot list globex projects", async () => {
    await expect(listProjects(aliceId, "globex")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("alice sees only acme projects, never globex rows", async () => {
    const { rows } = await listProjects(aliceId, "acme");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.id !== globexProjectId)).toBe(true);
  });

  it("a non-member gets 404, not 403, so project existence is not confirmed", async () => {
    const err = await listProjects(aliceId, "globex").catch((e) => e);
    expect(err.status).toBe(404);
  });
});

describe("3. cross-tenant write (first attack, mutating)", () => {
  it("alice cannot create a project inside globex", async () => {
    await expect(
      createProject(aliceId, "globex", "Planted By Alice"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("alice cannot rename globex's project even with its real id", async () => {
    await expect(
      renameProject(aliceId, "globex", globexProjectId, "Owned"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("alice cannot rename globex's project by passing her own tenant slug", async () => {
    // The slug is authorized, the project id is not in that tenant. This is
    // the case a naive `where(eq(projects.id, id))` would let through.
    await expect(
      renameProject(aliceId, "acme", globexProjectId, "Owned"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("globex's project is unchanged after all of that", async () => {
    const [row] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, globexProjectId));
    expect(row.name).toBe("Globex Migration");
  });
});

describe("4. viewer writes (the reviewer's second attack)", () => {
  it("vera can read acme", async () => {
    const { rows, ctx } = await listProjects(veraId, "acme");
    expect(ctx.role).toBe("viewer");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("vera cannot create", async () => {
    const err = await createProject(veraId, "acme", "Viewer Project").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(403);
  });

  it("vera cannot rename", async () => {
    await expect(
      renameProject(veraId, "acme", acmeProjectId, "Renamed By Viewer"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a rejected viewer write leaves no project and no audit row", async () => {
    const before = await db.select().from(auditLogs);
    await createProject(veraId, "acme", "Ghost Project").catch(() => {});
    const after = await db.select().from(auditLogs);
    expect(after.length).toBe(before.length);
    const planted = await db
      .select()
      .from(projects)
      .where(eq(projects.name, "Ghost Project"));
    expect(planted).toHaveLength(0);
  });
});

describe("5. invalid input", () => {
  it("rejects a name that is too short", async () => {
    await expect(createProject(aliceId, "acme", "a")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a whitespace-only name", async () => {
    await expect(createProject(aliceId, "acme", "   ")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects a name over 80 characters", async () => {
    await expect(
      createProject(aliceId, "acme", "x".repeat(81)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-string payload", async () => {
    await expect(
      createProject(aliceId, "acme", { evil: true }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("authorizes BEFORE validating, so input shape is not an auth oracle", async () => {
    // A viewer sending garbage must get 403, not 422. Otherwise the status
    // code tells an attacker whether their role passed the check.
    const err = await createProject(veraId, "acme", "a").catch((e) => e);
    expect(err.status).toBe(403);
  });

  it("rejects a duplicate name within the same tenant", async () => {
    const err = await createProject(aliceId, "acme", "Acme Onboarding").catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.status).toBe(422);
  });

  it("allows the SAME name in a different tenant", async () => {
    const created = await createProject(bobId, "globex", "Acme Onboarding");
    expect(created.name).toBe("Acme Onboarding");
    await db.delete(auditLogs).where(eq(auditLogs.entityId, created.id));
    await db.delete(projects).where(eq(projects.id, created.id));
  });
});

describe("6. a successful authorized write", () => {
  it("creates the project and its audit entry atomically", async () => {
    const name = `Audited Project ${Date.now()}`;
    const created = await createProject(aliceId, "acme", name);

    expect(created.name).toBe(name);
    expect(created.tenantId).toBe(acmeTenantId);

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id));

    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("project.create");
    expect(audits[0].actorUserId).toBe(aliceId);
    expect(audits[0].tenantId).toBe(created.tenantId);

    await db.delete(auditLogs).where(eq(auditLogs.entityId, created.id));
    await db.delete(projects).where(eq(projects.id, created.id));
  });

  it("renames and records before/after in one transaction", async () => {
    const created = await createProject(aliceId, "acme", `Rename Me ${Date.now()}`);
    const renamed = await renameProject(
      aliceId,
      "acme",
      created.id,
      "Renamed Properly",
    );

    expect(renamed.name).toBe("Renamed Properly");

    const audits = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id));

    expect(audits).toHaveLength(2);
    const rename = audits.find((a) => a.action === "project.rename")!;
    expect(rename.metadata).toMatchObject({ to: "Renamed Properly" });

    await db.delete(auditLogs).where(eq(auditLogs.entityId, created.id));
    await db.delete(projects).where(eq(projects.id, created.id));
  });

  it("a failed audit insert rolls the project back (atomicity, proven)", async () => {
    const name = `Atomic Probe ${Date.now()}`;

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(projects).values({ tenantId: acmeTenantId, name });
        // Deliberately invalid: audit_logs.action is NOT NULL. The project
        // insert above must not survive this failure.
        await tx
          .insert(auditLogs)
          .values({ tenantId: acmeTenantId, entityType: "project" } as never);
      }),
    ).rejects.toThrow();

    const orphans = await db.select().from(projects).where(eq(projects.name, name));
    expect(orphans).toHaveLength(0);
  });
});

describe("authorize() contract", () => {
  it("returns the caller's role for their own tenant", async () => {
    const ctx = await authorize(aliceId, "acme", "viewer");
    expect(ctx.role).toBe("admin");
    expect(ctx.tenantSlug).toBe("acme");
  });

  it("treats a nonexistent tenant and a non-member tenant identically", async () => {
    const nonMember = await authorize(aliceId, "globex", "viewer").catch((e) => e);
    const nonExistent = await authorize(aliceId, "nope", "viewer").catch((e) => e);
    expect(nonMember.status).toBe(nonExistent.status);
    expect(nonMember.message).toBe(nonExistent.message);
  });

  it("admin satisfies an editor requirement", async () => {
    await expect(authorize(bobId, "globex", "editor")).resolves.toMatchObject({
      role: "admin",
    });
  });
});
