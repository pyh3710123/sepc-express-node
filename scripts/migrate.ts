import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { loadConfig } from '../src/config';

/** 按文件名顺序执行尚未登记的数据库迁移，并逐个迁移提交事务。 */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: loadConfig().databaseUrl });
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const names = (await readdir(join(process.cwd(), 'migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of names) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [
          name,
        ]);
        if (existing.rowCount === 0) {
          await client.query(await readFile(join(process.cwd(), 'migrations', name), 'utf8'));
          await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
          process.stdout.write(`Applied ${name}\n`);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
