import { headers } from "next/headers";
import { auth } from "./auth";

/**
 * The ONLY place a user identity enters the system. Reads the signed session
 * cookie server-side via better-auth. Nothing the client sends in a form
 * field, query string or header is treated as identity.
 */
export async function currentUserId(): Promise<string | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user?.id ?? null;
}

export async function currentUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}
