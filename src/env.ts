import { config } from "dotenv";

// Precedence: real process env (Vercel, CI) > .env.local > .env
// dotenv never overrides an already-set variable, so loading in this order
// gives exactly that.
config({ path: ".env.local" });
config();
