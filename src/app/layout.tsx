import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TenantDesk",
  description: "A tiny multi-tenant project tracker.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
