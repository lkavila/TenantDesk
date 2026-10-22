import "dotenv/config";
import { config } from "dotenv";

// .env.local wins for local runs; CI supplies real env vars.
config({ path: ".env.local", override: false });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Tests run against a real Postgres on purpose: " +
      "a mocked database cannot prove the tenant boundary holds.",
  );
}
