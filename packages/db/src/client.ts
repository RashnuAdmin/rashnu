import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

/**
 * Lazily initialized so importing this module never crashes `next build` before
 * DATABASE_URL exists (e.g. before the Neon integration is provisioned). Deliberately
 * a plain function, not a Proxy - a Proxy wrapper here would break any library that
 * inspects this client's shape (method existence, property iteration).
 */
export function getDb(): Db {
  if (!_db) {
    const sql = neon(requireEnv("DATABASE_URL"));
    _db = drizzle(sql, { schema });
  }
  return _db;
}
