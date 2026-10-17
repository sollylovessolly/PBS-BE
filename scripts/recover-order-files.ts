import { Client } from 'pg';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { bucket, storageClient } from './storage-client';

/** Recover referenced artwork through the old backend when its storage URL changed. */
async function main() {
  const legacy = new URL(
    process.env.LEGACY_API_URL || 'https://polaroidsbysolly-be.onrender.com',
  ).origin;
  const db = new Client({ connectionString: process.env.DIRECT_URL });
  await db.connect();
  const objects = new Map<string, string>();
  try {
    const result = await db.query<{ customization: Record<string, unknown> }>(
      'SELECT customization FROM "OrderItem" WHERE customization IS NOT NULL',
    );
    for (const row of result.rows)
      for (const field of ['finalPngUrl', 'previewUrl', 'finalPdfUrl']) {
        const value = row.customization[field];
        if (typeof value !== 'string') continue;
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          continue;
        }
        const match = url.pathname.match(
          /^\/api\/uploads\/files\/([A-Za-z0-9_-]+)$/,
        );
        if (url.origin !== legacy || !match) continue;
        const key = Buffer.from(match[1], 'base64url').toString();
        if (!/^production\/[a-z_]+\/[a-zA-Z0-9._-]+$/.test(key)) continue;
        objects.set(key, legacy + url.pathname);
      }
  } finally {
    await db.end();
  }
  if (!process.argv.includes('--apply')) {
    console.log(
      `Dry run: ${objects.size} unique legacy artwork files referenced by orders. Add --apply to recover and checksum-verify.`,
    );
    return;
  }
  const storage = storageClient();
  const hash = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  let copied = 0;
  let verified = 0;
  let unavailable = 0;
  const failures: Record<string, number> = {};
  for (const [Key, url] of objects) {
    const source = await fetch(url, { signal: AbortSignal.timeout(80_000) });
    const ContentType = source.headers.get('content-type')?.split(';')[0] ?? '';
    if (
      !source.ok ||
      !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(
        ContentType,
      )
    ) {
      unavailable++;
      failures[String(source.status)] =
        (failures[String(source.status)] || 0) + 1;
      continue;
    }
    const bytes = Buffer.from(await source.arrayBuffer());
    let existing: Buffer | undefined;
    try {
      const current = await storage.send(
        new GetObjectCommand({ Bucket: bucket(), Key }),
      );
      existing = Buffer.from(await current.Body!.transformToByteArray());
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw error;
    }
    if (existing && hash(existing) !== hash(bytes))
      throw new Error(
        'Destination conflict; existing artwork was not overwritten',
      );
    if (!existing) {
      await storage.send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key,
          ContentType,
          Body: bytes,
        }),
      );
      copied++;
    }
    const destination = await storage.send(
      new GetObjectCommand({ Bucket: bucket(), Key }),
    );
    if (
      hash(Buffer.from(await destination.Body!.transformToByteArray())) !==
      hash(bytes)
    )
      throw new Error('Recovered artwork checksum mismatch');
    verified++;
  }
  console.log(
    JSON.stringify({
      copied,
      verified,
      unavailable,
      failures,
      originalsRetained: true,
    }),
  );
  if (unavailable) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    'Legacy artwork recovery could not complete; original references and source files were retained.',
  );
  process.exitCode = 1;
});
