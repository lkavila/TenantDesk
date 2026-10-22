import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { account, session, user, verification } from "@/db/schema";

// Vercel exposes two different hosts and picking the wrong one breaks sign-in:
//
//   VERCEL_URL                      per-deployment, e.g. tenantdesk-ab12cd.vercel.app
//   VERCEL_PROJECT_PRODUCTION_URL   the stable alias,  e.g. tenantdesk-eight.vercel.app
//
// Users arrive on the stable alias, so that is what baseURL and trustedOrigins
// must contain. Using VERCEL_URL made Better Auth reject every browser sign-in
// with 403 INVALID_ORIGIN, because the browser's Origin header carried the
// alias while the allowlist held the deployment host. curl never caught it:
// curl sends no Origin header, so the check does not run.
function baseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Every host this app can legitimately be reached on. Preview deployments are
// served from VERCEL_URL, production from the alias, local dev from localhost.
function trustedOrigins(): string[] {
  const origins = [
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL &&
      `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`,
    process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`,
    !process.env.VERCEL && "http://localhost:3000",
  ].filter((o): o is string => Boolean(o));

  return [...new Set(origins)];
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  // On Vercel the host differs per deployment, so fall back to VERCEL_URL
  // rather than a hardcoded localhost that would break the preview.
  baseURL: baseUrl(),
  trustedOrigins: trustedOrigins(),
  // Email + password only, on purpose. No OAuth provider means no external
  // console to configure and the reviewer can sign in with seeded credentials.
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
});
