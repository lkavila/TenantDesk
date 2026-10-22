# TenantDesk

A tiny multi-tenant project tracker. Two organizations, three users, role-based
writes, audited and atomic.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Drizzle ORM ·
PostgreSQL (Neon, pooled) · Better Auth · Vitest.

- **Live:** https://tenantdesk-eight.vercel.app
- **Repository:** https://github.com/lkavila/TenantDesk
- **Code commit:** `1c826e6`
- **Evidence (commands + results):** [`EVIDENCE.md`](./EVIDENCE.md)
- **AI collaboration log:** [`AI_LOG.md`](./AI_LOG.md)

---

## Test logins

All three accounts share one password, taken from `SEED_PASSWORD`
(default `TenantDesk!2026`). Dev/test data only — no production data anywhere
in this repo.

| Email              | Role   | Member of     | Use it to show |
|--------------------|--------|---------------|----------------|
| `alice@acme.test`  | admin  | Acme **only** | cross-tenant denial: she cannot reach Globex |
| `bob@globex.test`  | admin  | Globex **only** | owns the project Alice will try to reach |
| `vera@acme.test`   | viewer | Acme **only** | viewer write denial |

Seeded projects: `Acme Onboarding` (Acme), `Globex Migration` (Globex).

### The two attacks, by hand

1. **Read B as A.** Sign in as `alice@acme.test`, then visit `/t/globex`.
   Expect the 404 page, not Globex data. The tenant slug in the URL is a
   request; it is re-resolved against Alice's memberships server-side.
2. **Viewer write.** Sign in as `vera@acme.test`, open `/t/acme`. The create
   and rename controls are not rendered. Replaying the server action by hand
   still returns 403 — the UI hiding the button is cosmetic, not the control.

---

## Setup

```bash
npm install
cp .env.example .env.local      # then fill in DATABASE_URL
npm run db:migrate              # applies drizzle/0000_init.sql
npm run db:seed                 # 2 tenants, 3 users, 2 projects, audit rows
npm run dev                     # http://localhost:3000
```

`DATABASE_URL` must be a **pooled** connection string that supports
transactions. On Neon use the `-pooler` host. The Neon **HTTP** driver is not
usable here: a project write and its audit entry must be atomic, which needs a
real multi-statement transaction.

## Tests

```bash
npm test
```

The suite runs against a real Postgres with the seed loaded. It covers, in
order: unauthenticated read and write, cross-tenant read, cross-tenant write
(including passing a foreign project id under an authorized tenant slug),
viewer create and rename, four invalid-input shapes, duplicate names within
and across tenants, a successful authorized write with its audit row, and a
forced-rollback proof of atomicity.

Exact commands and results are in [`EVIDENCE.md`](./EVIDENCE.md).

---

## Authorization: application-level, not RLS

**Application authorization only.** Stated plainly because the assessment asks.

Every read and write passes through one function, `authorize()` in
[`src/lib/authz.ts`](./src/lib/authz.ts):

```
authorize(userId, tenantSlug, minRole) -> ActorContext | throws
```

- `userId` is resolved server-side from the Better Auth session cookie in
  [`src/lib/session.ts`](./src/lib/session.ts). Nothing in a form field, query
  string or header is ever treated as identity.
- `tenantSlug` is whatever the client asked for. It is joined against
  `memberships` for that user before any domain query runs.
- Role comparison is a rank check: `viewer < editor < admin`.

Status codes are a security decision, not formatting:

| Situation | Status | Why |
|---|---|---|
| No session | 401 | Before any tenant lookup, so an anonymous caller cannot probe which slugs exist. |
| Authenticated, not a member | **404** | Identical to a tenant that does not exist. A 403 would confirm the tenant is real and hand an attacker a valid id to probe. |
| Member, role too low | 403 | They can already see this tenant, so the status leaks nothing new. |
| Bad input from an unauthorized caller | 403, **not** 422 | Authorization runs before validation, so the error shape is not an auth oracle. |

A second line of defense sits in the queries themselves: every project read and
write is scoped by `tenant_id` **and** `id`, so a foreign project id matches no
row even if `authorize()` were bypassed. There is a test for exactly that.

### Why not RLS

Postgres RLS was considered and deliberately **not** used. Honest reasons:

1. RLS needs per-request tenant context (`SET LOCAL app.tenant_id`) inside a
   transaction, and it only has teeth when the app connects as a
   **non-superuser** role. Connecting as the database owner makes the policies
   decoration. Wiring a second restricted role, a connection-level context
   setter, and policies for four tables correctly is not something to
   half-finish inside this time budget.
2. A half-wired RLS layer that the tests cannot prove is worse than a single
   application boundary that they can.

What is in the schema instead of policies, as defense in depth:

- `UNIQUE (tenant_id, name)` on `projects` — tenant-aware uniqueness: two
  tenants may both own "Apollo"; one tenant may not own it twice.
- `UNIQUE (tenant_id, user_id)` on `memberships` — one role per user per
  tenant, duplicate grants impossible.
- `INDEX (tenant_id, created_at)` on `projects` and `audit_logs` — matches the
  only access path there is, so the tenant filter is never a scan.
- `UNIQUE (tenant_id, id)` on `projects` — makes the tenant-qualified pair a
  referenceable key.
- `tenant_id NOT NULL` with `ON DELETE CASCADE` on every tenant-scoped table.

**If this were going to production**, RLS goes in as the backstop underneath
the application layer, not instead of it. That is the right end state; it is
not what is in this commit.

---

## Atomicity

`createProject` and `renameProject` each wrap their domain write and their
audit insert in one `db.transaction()`
([`src/lib/projects.ts`](./src/lib/projects.ts)). There is no state where a
project exists without the audit entry recording who created or renamed it.

This is proven, not asserted: one test forces the audit insert to violate a
`NOT NULL` constraint inside the transaction and then asserts the project row
is absent.

---

## Limitations

Documented honestly rather than hidden.

- **No RLS.** Reasoning above. Application authorization is the only boundary.
- **`audit_logs.entity_id` has no foreign key.** It is polymorphic
  (`entity_type` + `entity_id`), so a composite FK to `projects (tenant_id, id)`
  would break the moment a non-project entity is audited. The tenant
  consistency of an audit row is guaranteed by the service layer writing both
  rows in one transaction with the same `ctx.tenantId`, not by the database.
  A real system would either split the audit table per entity type or add a
  trigger.
- **No tenant switcher inside a tenant page.** Navigation is via the home page
  list. The list is built from `memberships`, so it cannot show a tenant the
  user lacks.
- **Role management is seed-only.** No invitation, no role-change UI. Out of
  scope per the brief.
- **Audit log is write-only.** Rows are persisted and tested but there is no UI
  to read them.
- **`ssl: { rejectUnauthorized: false }`** for non-localhost connections, which
  is the common Neon/Vercel setup but is not certificate pinning. Production
  should pin the CA.
- **No rate limiting** on the sign-in route. Better Auth's generic
  "credentials did not work" response avoids account enumeration, but nothing
  slows down brute force.
- **Tests share one database with the dev seed** and clean up after themselves
  rather than running in a disposable schema. A failed run can leave a stray
  row; re-running `npm run db:seed` resets it.
- **Not load tested.** Index choices are reasoned from the access paths, not
  measured.
