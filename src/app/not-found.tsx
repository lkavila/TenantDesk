import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: 48 }}>
      <h1 style={{ marginBottom: 8 }}>Not found</h1>
      <p className="muted">
        This organization or project does not exist, or you are not a member of it.
      </p>
      <p>
        <Link href="/">Back to your organizations</Link>
      </p>
    </div>
  );
}
