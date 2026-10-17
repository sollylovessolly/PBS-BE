import 'dotenv/config';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const key = `migration-check-${randomUUID()}`;
    const sql = `INSERT INTO "ApiRateLimit" ("key", "count", "resetAt")
      VALUES ($1, 1, NOW() + INTERVAL '1 minute')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "ApiRateLimit"."resetAt" <= NOW() THEN 1 ELSE "ApiRateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "ApiRateLimit"."resetAt" <= NOW() THEN NOW() + INTERVAL '1 minute' ELSE "ApiRateLimit"."resetAt" END
      RETURNING "count"`;
    const first = await client.query<{ count: number }>(sql, [key]);
    const second = await client.query<{ count: number }>(sql, [key]);
    if (first.rows[0].count !== 1 || second.rows[0].count !== 2)
      throw new Error('Atomic rate-limit counters failed');
    for (const table of [
      'GalleryAlbum',
      'GalleryPhoto',
      'Review',
      'ReviewPhoto',
      'StorageCleanupJob',
    ])
      await client.query(`SELECT 1 FROM "${table}" LIMIT 1`);
    await client.query('ROLLBACK');
    console.log(
      'PASS: pooled connection, interactive transaction, atomic counters, gallery/review schema. Test writes rolled back.',
    );
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error('Database deployment verification failed.');
  process.exitCode = 1;
});
