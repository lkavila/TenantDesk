"use server";

import { revalidatePath } from "next/cache";
import { createProject, renameProject } from "@/lib/projects";
import { currentUserId } from "@/lib/session";
import { ValidationError, statusOf } from "@/lib/errors";

export type ActionResult =
  | { ok: true }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

function toResult(e: unknown): ActionResult {
  const status = statusOf(e);
  if (e instanceof ValidationError) {
    return { ok: false, status, message: e.message, fieldErrors: e.fieldErrors };
  }
  if (status === 404) {
    return { ok: false, status, message: "That organization or project was not found." };
  }
  if (status === 403) {
    return {
      ok: false,
      status,
      message: (e as Error).message || "Your role does not allow this action.",
    };
  }
  if (status === 401) {
    return { ok: false, status, message: "Your session expired. Sign in again." };
  }
  // Never leak an internal message to the client.
  console.error("[action] unexpected error", e);
  return { ok: false, status: 500, message: "Something went wrong. Try again." };
}

// Note: the tenant slug arrives from the client. It is a REQUEST. Every call
// below re-resolves it against the caller's memberships server-side before
// touching data.

export async function createProjectAction(
  slug: string,
  name: string,
): Promise<ActionResult> {
  try {
    await createProject(await currentUserId(), slug, name);
    revalidatePath(`/t/${slug}`);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}

export async function renameProjectAction(
  slug: string,
  projectId: string,
  name: string,
): Promise<ActionResult> {
  try {
    await renameProject(await currentUserId(), slug, projectId, name);
    revalidatePath(`/t/${slug}`);
    return { ok: true };
  } catch (e) {
    return toResult(e);
  }
}
