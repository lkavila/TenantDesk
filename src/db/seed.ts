import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import { auditLogs, memberships, projects, tenants, user } from "./schema";
import { auth } from "../lib/auth";

// ---------------------------------------------------------------------------
// Seed data. Dev/test only: no production data, no real customers.
// Three users, chosen to make the two attacks the reviewer will try
// expressible:
//   alice@acme.test   -> admin  in acme ONLY        (tries to reach globex)
//   bob@globex.test   -> admin  in globex ONLY      (owns the target project)
//   vera@acme.test    -> viewer in acme ONLY        (tries to write)
// ---------------------------------------------------------------------------

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "TenantDesk!2026";

const TENANTS = [
  { slug: "acme", name: "Acme Corp" },
  { slug: "globex", name: "Globex Inc" },
];

const USERS = [
  { email: "alice@acme.test", name: "Alice Admin", tenant: "acme", role: "admin" as const },
  { email: "bob@globex.test", name: "Bob Builder", tenant: "globex", role: "admin" as const },
  { email: "vera@acme.test", name: "Vera Viewer", tenant: "acme", role: "viewer" as const },
];

const PROJECTS = [
  { tenant: "acme", name: "Acme Onboarding" },
  { tenant: "globex", name: "Globex Migration" },
];

async function upsertUser(email: string, name: string): Promise<string> {
  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (existing) return existing.id;

  // Register through better-auth so the password is hashed by the same code
  // path that verifies it at sign-in. Never insert a hash by hand.
  await auth.api.signUpEmail({
    body: { email, name, password: SEED_PASSWORD },
  });

  const [created] = await db.select().from(user).where(eq(user.email, email)).limit(1);
  if (!created) throw new Error(`Failed to create user ${email}`);
  return created.id;
}

async function main() {
  console.log("Seeding TenantDesk ...");

  // Idempotent: wipe domain rows, leave auth rows (passwords) alone.
  await db.delete(auditLogs);
  await db.delete(projects);
  await db.delete(memberships);
  await db.delete(tenants);

  const tenantIds = new Map<string, string>();
  for (const t of TENANTS) {
    const [row] = await db.insert(tenants).values(t).returning();
    tenantIds.set(t.slug, row.id);
    console.log(`  tenant ${t.slug} -> ${row.id}`);
  }

  const userIds = new Map<string, string>();
  for (const u of USERS) {
    const id = await upsertUser(u.email, u.name);
    userIds.set(u.email, id);
    await db.insert(memberships).values({
      tenantId: tenantIds.get(u.tenant)!,
      userId: id,
      role: u.role,
    });
    console.log(`  ${u.email} -> ${u.role} in ${u.tenant}`);
  }

  for (const p of PROJECTS) {
    const tenantId = tenantIds.get(p.tenant)!;
    const actor = USERS.find((u) => u.tenant === p.tenant && u.role === "admin")!;
    const actorId = userIds.get(actor.email)!;
    const [row] = await db
      .insert(projects)
      .values({ tenantId, name: p.name, createdBy: actorId })
      .returning();
    await db.insert(auditLogs).values({
      tenantId,
      actorUserId: actorId,
      action: "project.create",
      entityType: "project",
      entityId: row.id,
      metadata: { name: p.name, source: "seed" },
    });
    console.log(`  project ${p.name} -> ${row.id} (${p.tenant})`);
  }

  console.log("\nSeed complete. Test logins (password from SEED_PASSWORD):");
  for (const u of USERS) {
    console.log(`  ${u.email.padEnd(20)} ${u.role.padEnd(7)} ${u.tenant}`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
