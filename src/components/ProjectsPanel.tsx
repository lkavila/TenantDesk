"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProjectAction, renameProjectAction } from "@/app/t/[slug]/actions";
import type { ActionResult } from "@/app/t/[slug]/actions";

type ProjectView = { id: string; name: string; createdAt: string };

// Mirrors the server schema so the user gets feedback before a round trip.
// The server validates again; this is convenience, never the boundary.
function clientValidate(name: string): string | null {
  const v = name.trim();
  if (v.length < 2) return "Name must be at least 2 characters.";
  if (v.length > 80) return "Name must be 80 characters or fewer.";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(v))
    return "Use letters, numbers, spaces, dots, underscores or hyphens.";
  return null;
}

export default function ProjectsPanel({
  slug,
  role,
  writable,
  initialProjects,
}: {
  slug: string;
  role: string;
  writable: boolean;
  initialProjects: ProjectView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  function applyResult(res: ActionResult, onOk: () => void, setErr: (s: string) => void) {
    if (res.ok) {
      onOk();
      startTransition(() => router.refresh());
      return;
    }
    setErr(res.fieldErrors?.name ?? res.message);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setNotice(null);

    const clientError = clientValidate(newName);
    if (clientError) {
      setCreateError(clientError);
      return;
    }

    const res = await createProjectAction(slug, newName);
    applyResult(
      res,
      () => {
        setNewName("");
        setNotice("Project created.");
      },
      setCreateError,
    );
  }

  async function onRename(e: React.FormEvent, id: string) {
    e.preventDefault();
    setEditError(null);
    setNotice(null);

    const clientError = clientValidate(editName);
    if (clientError) {
      setEditError(clientError);
      return;
    }

    const res = await renameProjectAction(slug, id, editName);
    applyResult(
      res,
      () => {
        setEditingId(null);
        setNotice("Project renamed.");
      },
      setEditError,
    );
  }

  return (
    <>
      <h2>Projects</h2>

      {initialProjects.length === 0 ? (
        <div className="empty">
          No projects yet.
          {writable ? " Create the first one below." : " A viewer cannot create one."}
        </div>
      ) : (
        <ul className="projects">
          {initialProjects.map((p) => (
            <li key={p.id}>
              {editingId === p.id ? (
                <form
                  className="row"
                  style={{ width: "100%" }}
                  onSubmit={(e) => onRename(e, p.id)}
                >
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    disabled={pending}
                    aria-label={`New name for ${p.name}`}
                    autoFocus
                  />
                  <button type="submit" disabled={pending}>
                    {pending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={() => {
                      setEditingId(null);
                      setEditError(null);
                    }}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <div>
                    <div>{p.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      created {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                  {writable && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setEditingId(p.id);
                        setEditName(p.name);
                        setEditError(null);
                        setNotice(null);
                      }}
                    >
                      Rename
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {editError && (
        <div className="error" role="alert">
          {editError}
        </div>
      )}

      {writable ? (
        <>
          <h2>New project</h2>
          <div className="panel">
            <form className="row" onSubmit={onCreate}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Project name"
                aria-label="Project name"
                disabled={pending}
              />
              <button type="submit" disabled={pending}>
                {pending ? "Creating..." : "Create"}
              </button>
            </form>
            {createError && (
              <div className="error" role="alert">
                {createError}
              </div>
            )}
            {notice && <div className="ok">{notice}</div>}
          </div>
        </>
      ) : (
        <p className="muted" style={{ marginTop: 16 }}>
          Your role is <strong>{role}</strong>, which is read-only. The create and
          rename controls are hidden, and the server rejects the write even if the
          request is replayed by hand.
        </p>
      )}
    </>
  );
}
