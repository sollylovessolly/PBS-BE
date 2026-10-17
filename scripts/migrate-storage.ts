import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { bucket, storageClient } from './storage-client';

type Entry = { name: string; id: string | null };
const digest = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

async function main() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sourceBucket =
    process.env.SUPABASE_STORAGE_BUCKET || 'production-files';
  if (!url || !key) throw new Error('Supabase source credentials are required');
  const apply = process.argv.includes('--apply');
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  const client = storageClient();
  let copied = 0;
  let verified = 0;
  const visit = async (prefix: string) => {
    for (let offset = 0; ; offset += 100) {
      const response = await fetch(
        `${url}/storage/v1/object/list/${encodeURIComponent(sourceBucket)}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prefix,
            limit: 100,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok)
        throw new Error(`Source listing failed: ${response.status}`);
      const entries = (await response.json()) as Entry[];
      for (const entry of entries) {
        const objectKey = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!entry.id) {
          await visit(objectKey);
          continue;
        }
        if (!apply) {
          verified++;
          continue;
        }
        const source = await fetch(
          `${url}/storage/v1/object/${encodeURIComponent(sourceBucket)}/${objectKey.split('/').map(encodeURIComponent).join('/')}`,
          {
            headers,
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (!source.ok)
          throw new Error(`Source download failed: ${source.status}`);
        const bytes = Buffer.from(await source.arrayBuffer());
        let existing: Buffer | undefined;
        try {
          const result = await client.send(
            new GetObjectCommand({ Bucket: bucket(), Key: objectKey }),
          );
          existing = Buffer.from(await result.Body!.transformToByteArray());
        } catch (error) {
          if (
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode !== 404
          )
            throw error;
        }
        if (existing && digest(existing) !== digest(bytes))
          throw new Error(
            'Destination conflict: migration stopped without overwriting the existing object',
          );
        if (!existing) {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket(),
              Key: objectKey,
              Body: bytes,
              ContentType:
                source.headers.get('content-type') ??
                'application/octet-stream',
            }),
          );
          copied++;
        }
        const destination = await client.send(
          new GetObjectCommand({ Bucket: bucket(), Key: objectKey }),
        );
        if (
          digest(
            Buffer.from(await destination.Body!.transformToByteArray()),
          ) !== digest(bytes)
        )
          throw new Error('Destination checksum verification failed');
        verified++;
      }
      if (entries.length < 100) break;
    }
  };
  await visit('');
  console.log(
    apply
      ? `Migration complete: ${copied} copied; ${verified} checksum-verified. Supabase originals retained.`
      : `Dry run: ${verified} source files found. Add --apply to copy and verify; originals are never deleted.`,
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Storage migration failed',
  );
  process.exitCode = 1;
});
