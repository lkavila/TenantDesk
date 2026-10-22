import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/session";
import { membershipsFor } from "@/lib/authz";
import SignOutButton from "@/components/SignOutButton";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");

  // The tenant list comes from memberships, server-side. A tenant the user is
  // not a member of is not rendered and could not be opened anyway.
  const tenants = await membershipsFor(user.id);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>TenantDesk</h1>
          <p className="muted" style={{ margin: 0 }}>
            Signed in as {user.email}
          </p>
        </div>
        <SignOutButton />
      </div>

      <h2>Your organizations</h2>

      {tenants.length === 0 ? (
        <div className="empty">
          You are not a member of any organization yet.
          <br />
          Run <code>npm run db:seed</code> to create the test data.
        </div>
      ) : (
        <ul className="projects">
          {tenants.map((t) => (
            <li key={t.tenantId}>
              <div>
                <Link href={`/t/${t.slug}`}>{t.name}</Link>
                <div className="muted" style={{ fontSize: 13 }}>
                  /{t.slug}
                </div>
              </div>
              <span className="badge">{t.role}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
