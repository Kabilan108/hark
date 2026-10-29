import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { env } from "../env";
import { db, sqlite } from "./index";

/**
 * Runs generated Drizzle migrations from HARK_MIGRATIONS_DIR, or from `drizzle/`
 * under the working directory: apps/website in dev and /app in Docker.
 */
export function runMigrations(): void {
  const migrationsFolder = resolve(env.HARK_MIGRATIONS_DIR ?? resolve(process.cwd(), "drizzle"));
  if (!existsSync(migrationsFolder)) {
    throw new Error(`Migrations folder not found at ${migrationsFolder}`);
  }
  // Drizzle wraps all SQLite migrations in a transaction. Foreign-key PRAGMAs
  // inside generated table-rebuild migrations are therefore ignored, so the
  // toggle must happen before Drizzle opens its transaction.
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  const violations = sqlite.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(`Database migration left ${violations.length} foreign-key violation(s)`);
  }
}
