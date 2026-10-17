import 'dotenv/config';
import { Client } from 'pg';

/** Run only after storage is copied and the new API has passed download checks. */
async function main() {
  const oldOrigin = new URL(
    process.env.LEGACY_API_URL || 'https://polaroidsbysolly-be.onrender.com',
  ).origin;
  const newOrigin = new URL(process.env.PUBLIC_API_URL || '').origin;
  if (newOrigin === oldOrigin || newOrigin.startsWith('http://localhost'))
    throw new Error(
      'Set PUBLIC_API_URL to the new HTTPS Vercel backend origin',
    );
  const client = new Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  try {
    const rows = await client.query<{
      id: string;
      customization: Record<string, unknown>;
    }>(
      'SELECT id, customization FROM "OrderItem" WHERE customization IS NOT NULL',
    );
    let count = 0;
    for (const row of rows.rows) {
      let changed = false;
      const customization = { ...row.customization };
      for (const field of ['finalPngUrl', 'previewUrl', 'finalPdfUrl']) {
        const value = customization[field];
        if (typeof value !== 'string') continue;
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          continue;
        }
        if (
          parsed.origin === oldOrigin &&
          parsed.pathname.startsWith('/api/uploads/files/')
        ) {
          customization[field] = newOrigin + parsed.pathname;
          changed = true;
        }
      }
      if (!changed) continue;
      count++;
      if (process.argv.includes('--apply'))
        await client.query(
          'UPDATE "OrderItem" SET customization = $1::jsonb WHERE id = $2',
          [JSON.stringify(customization), row.id],
        );
    }
    console.log(
      `${process.argv.includes('--apply') ? 'Updated' : 'Would update'} ${count} order artwork references.`,
    );
  } finally {
    await client.end();
  }
}
main().catch(() => {
  console.error(
    'Artwork URL migration failed; verify database access and PUBLIC_API_URL.',
  );
  process.exitCode = 1;
});
