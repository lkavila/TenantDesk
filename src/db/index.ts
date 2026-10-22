import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// node-postgres over a POOLED connection string, deliberately.
// The project write and its audit entry must be atomic, which needs a real
// multi-statement transaction. Neon's HTTP driver cannot do that, so it is
// not an option here even though it is the faster one for single statements.
const globalForDb = globalThis as unknown as { pool?: Pool };

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }
  return url;
}

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: connectionString(),
    max: 10,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")
      ? undefined
      : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
