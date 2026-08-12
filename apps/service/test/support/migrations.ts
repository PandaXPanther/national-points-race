import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";

const testEnv = env as typeof env & {
  TEST_MIGRATIONS: D1Migration[];
};

export async function applyMigrations(db: D1Database): Promise<void> {
  await applyD1Migrations(db, testEnv.TEST_MIGRATIONS);
}

await applyMigrations(testEnv.DB);
await applyMigrations(testEnv.DB);
