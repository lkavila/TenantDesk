import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUserId } from "@/lib/session";
import { listProjects } from "@/lib/projects";
import { canWrite } from "@/lib/authz";
import { NotFoundError, UnauthenticatedError } from "@/lib/errors";
import ProjectsPanel from "@/components/ProjectsPanel";

function Pending() {
  return (
    <div className="projects" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}

async function TenantView({ slug }: { slug: string }) {
  let data;
  try {
    data = await listProjects(await currentUserId(), slug);
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    // A tenant the caller is not a member of is indistinguishable from one
    // that does not exist. Both render the same 404 page.
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  const { ctx, rows } = data;
  const writable = canWrite(ctx.role);

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>{ctx.tenantName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <Link href="/">All organizations</Link> &middot; /{ctx.tenantSlug}
          </p>
        </div>
        <span className="badge">{ctx.role}</span>
      </div>

      <ProjectsPanel
        slug={ctx.tenantSlug}
        role={ctx.role}
        writable={writable}
        initialProjects={rows.map((r) => ({
          id: r.id,
          name: r.name,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </>
  );
}

export default async function TenantPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<Pending />}>
      <TenantView slug={slug} />
    </Suspense>
  );
}
