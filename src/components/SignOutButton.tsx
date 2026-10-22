"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export default function SignOutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    await signOut();
    startTransition(() => router.replace("/login"));
    setBusy(false);
  }

  return (
    <button className="secondary" onClick={handle} disabled={busy || pending}>
      {busy || pending ? "Signing out..." : "Sign out"}
    </button>
  );
}
