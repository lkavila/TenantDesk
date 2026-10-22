"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter both an email and a password.");
      return;
    }

    setPending(true);
    const res = await signIn.email({ email: email.trim(), password });
    setPending(false);

    if (res.error) {
      // Deliberately generic: distinguishing "no such user" from "wrong
      // password" would turn this form into an account enumerator.
      setError("Those credentials did not work.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <>
      <h1>Sign in to TenantDesk</h1>
      <p className="muted">Identity is resolved on the server from a signed session cookie.</p>

      <div className="panel" style={{ marginTop: 16, maxWidth: 420 }}>
        <form className="stack" onSubmit={onSubmit}>
          <label>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
              Email
            </div>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </label>
          <label>
            <div className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
              Password
            </div>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </label>
          <button type="submit" disabled={pending}>
            {pending ? "Signing in..." : "Sign in"}
          </button>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </form>
      </div>
    </>
  );
}
