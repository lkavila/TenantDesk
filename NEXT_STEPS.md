# Known limitations and next steps

## What is unfinished

Ordered by how much it would matter to someone depending on this.

### 1. The test suite stops one layer below the HTTP boundary

`tests/authz.test.ts` drives `listProjects` / `createProject` / `renameProject`
directly, with real user ids against real Postgres. That is the real
authorization logic, not a mock — but it is **not** the server action invoked
over HTTP with a forged session cookie. Requirement 5 asks for the real
authorization boundary, and the service layer is where that boundary lives, so
this is defensible. It is still a layer short of proving the wire path.

The gap is not theoretical. A bug that lived **only** above the service layer
shipped to production and the suite stayed green: the `INVALID_ORIGIN` failure
in `EVIDENCE.md` section 7, which broke sign-in for every browser while all 27
tests passed. That is exactly the class of defect an HTTP-level test catches.

### 2. `/t/<foreign-tenant>` answers HTTP 200, not 404

The tenant view is wrapped in `<Suspense>` for the required pending state, so
Next streams a 200 shell and the `notFound()` result arrives inside the stream.
No data crosses — verified byte-for-byte — and the service layer does return
404, asserted directly in the suite. But a reviewer grading on status lines
sees 200.

### 3. No RLS

Deliberate, with reasoning in the README. Application authorization is the only
boundary; a single `authorize()` chokepoint plus queries scoped by `tenant_id`
and `id`. If the app's database role were ever compromised, or a future
developer added a query that forgot the tenant filter, nothing underneath would
stop it.

### 4. `audit_logs.entity_id` carries no foreign key

It is polymorphic (`entity_type` + `entity_id`), so a composite FK to
`projects (tenant_id, id)` breaks the first time a non-project entity is
audited. Tenant consistency of an audit row is guaranteed by the service writing
both rows in one transaction with the same `ctx.tenantId` — by code, not by the
database.

### 5. Concurrency is untested

Two simultaneous renames of the same project are a last-write-wins race. There
is no optimistic locking (no version column, no `updated_at` precondition) and
no test that attempts it.

### 6. Smaller gaps

- Audit log is write-only; rows are persisted and tested, no UI reads them.
- Role management is seed-only. No invitations, no role-change UI (out of scope
  per the brief).
- Rate limiting is Better Auth's default. Observed working (429), never
  configured or measured.
- `ssl: { rejectUnauthorized: false }` for non-localhost. Standard Neon/Vercel
  setup, but not certificate pinning.
- Tests share one Neon database with the deployed app and clean up after
  themselves. A failed run can leave a stray row; `npm run db:seed` resets it.
- Deployed with `--prod` rather than as a preview, because a plain preview URL
  sits behind Vercel Deployment Protection and would not be reachable.
- No load testing. Index choices are reasoned from access paths, not measured.

---

## What I would fix first with one more hour

### 0:00-0:25 — An HTTP-level authorization test (limitation 1)

The highest-value hour is spent closing the gap that already let a production
bug through. Three tests, driving the deployed or locally-served app over real
HTTP with a real session cookie per persona:

- Alice's cookie → `POST` the create action scoped to `globex` → expect denial,
  then assert in Postgres that no row was written.
- Vera's cookie → `POST` the rename action on an Acme project → expect 403.
- No cookie → both actions → expect 401.

This also pins the `trustedOrigins` regression permanently, which is the
specific failure that shipped.

### 0:25-0:40 — Make the 404 real (limitation 2)

Move the pending state from a `<Suspense>` boundary into `loading.tsx`, or
resolve membership before the streaming boundary, so `notFound()` sets a true
404 status. Then assert the status code over HTTP in the test added above.
Status codes are part of the authorization contract, not cosmetics.

### 0:40-0:55 — RLS as a backstop, properly (limitation 3)

Not as a replacement for `authorize()` — underneath it:

1. A second non-superuser database role for tenant-scoped queries, with the
   owner role reserved for migrations and auth.
2. `ALTER TABLE … ENABLE ROW LEVEL SECURITY` plus a `USING (tenant_id =
   current_setting('app.tenant_id')::uuid)` policy on `projects` and
   `audit_logs`.
3. Set `app.tenant_id` with `SET LOCAL` inside the existing transactions.
4. The test that earns it: issue a deliberately tenant-unfiltered query as the
   restricted role and assert it returns zero rows. Without that test the
   policies are decoration.

Fifteen minutes is enough for projects and audit_logs, not for all four tables.
I would ship it narrow and say so, rather than claim full coverage.

### 0:55-1:00 — Optimistic locking on rename (limitation 5)

Add a `version` integer to `projects`, make the rename `WHERE version = $n`,
and surface a "this project changed, reload" failure state. The UI already has
the failure-state plumbing, so this is mostly schema plus one test.

### Explicitly not in that hour

Invitations, email, billing, audit-log UI, visual design, load testing. Out of
scope per the brief, and none of them is where the risk is.

---

## Deployment failure evidence

The deployment is live at https://tenantdesk-eight.vercel.app, so no failure
fallback is required. Two failures happened on the way and both are recorded in
full in `EVIDENCE.md` rather than smoothed over:

**1. Vercel rejected the first deploy.**

```
$ vercel deploy --prod
Error: Vulnerable version of Next.js detected, please update immediately.
```

Next was pinned to 15.3.4 by hand during scaffolding. Upgraded to 16.4.2, then
`tsc --noEmit`, all 27 tests and the production build were re-run green before
redeploying.

**2. The deploy succeeded and the app was still broken.**

```
POST /api/auth/sign-in/email -> 403
{"message":"Invalid origin","code":"INVALID_ORIGIN"}
```

`trustedOrigins` held the per-deployment host while browsers arrived on the
stable alias. curl never caught it because curl sends no `Origin` header. Root
cause, fix, and browser-verified re-test are in `EVIDENCE.md` section 7.
