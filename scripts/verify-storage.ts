import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { bucket, storageClient } from './storage-client';

async function main() {
  const client = storageClient();
  const Bucket = bucket();
  const Key = `incoming/migration-check-${randomUUID()}`;
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  await client.send(new HeadBucketCommand({ Bucket }));
  const grant = await createPresignedPost(client, {
    Bucket,
    Key,
    Expires: 60,
    Fields: { 'Content-Type': 'image/png' },
    Conditions: [
      ['eq', '$Content-Type', 'image/png'],
      ['content-length-range', bytes.length, bytes.length],
    ],
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(grant.fields))
    form.append(key, value);
  form.append('file', new Blob([bytes], { type: 'image/png' }), 'check.png');
  try {
    const uploaded = await fetch(grant.url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!uploaded.ok)
      throw new Error(`Presigned upload failed: ${uploaded.status}`);
    const signed = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket, Key }),
      { expiresIn: 60 },
    );
    const response = await fetch(signed, {
      signal: AbortSignal.timeout(30_000),
    });
    if (
      !response.ok ||
      !Buffer.from(await response.arrayBuffer()).equals(bytes)
    )
      throw new Error('Signed download verification failed');
    const privateUrl = `${process.env.AWS_ENDPOINT_URL_S3}/${encodeURIComponent(Bucket)}/${Key}`;
    const anonymous = await fetch(privateUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (anonymous.ok) throw new Error('Bucket allows anonymous access');
    // The same policy must reject a different file size.
    const oversized = new FormData();
    for (const [key, value] of Object.entries(grant.fields))
      oversized.append(key, value);
    oversized.append(
      'file',
      new Blob([bytes, bytes], { type: 'image/png' }),
      'wrong.png',
    );
    const rejected = await fetch(grant.url, {
      method: 'POST',
      body: oversized,
      signal: AbortSignal.timeout(30_000),
    });
    if (rejected.ok)
      throw new Error('Storage did not enforce the upload size policy');
    console.log(
      'PASS: private bucket; direct upload; signed download; exact upload-size policy.',
    );
  } finally {
    // Only remove the disposable object created by this verification.
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Storage verification failed',
  );
  process.exitCode = 1;
});
