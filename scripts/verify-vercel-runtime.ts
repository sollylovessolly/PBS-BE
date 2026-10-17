import { parse } from 'dotenv';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { bucket, storageClient } from './storage-client';

async function main() {
  const testDatabase = parse(readFileSync('.env.migration-test'));
  const origin = 'http://127.0.0.1:4019';
  const server = spawn(process.execPath, ['dist/src/main.js'], {
    env: {
      ...process.env,
      ...testDatabase,
      NODE_ENV: 'test',
      VERCEL: '1',
      PORT: '4019',
      STORAGE_PROVIDER: 'neon',
      PUBLIC_API_URL: origin,
      UPLOAD_RATE_LIMIT_PER_MINUTE: '100',
    },
    stdio: 'ignore',
  });
  const client = storageClient();
  const keys: string[] = [];
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(`${origin}/api/health/ready`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('Isolated API failed to start');
    const browserOrigin = 'http://localhost:3000';
    const preflight = await fetch(`${origin}/api/uploads/direct`, {
      method: 'OPTIONS',
      headers: {
        Origin: browserOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    if (preflight.headers.get('access-control-allow-origin') !== browserOrigin)
      throw new Error('API browser upload origin is not allowed');
    for (const path of ['/gallery/featured', '/reviews']) {
      const response = await fetch(`${origin}/api${path}`);
      if (!response.ok) throw new Error(`${path} failed`);
    }
    const cron = await fetch(`${origin}/api/maintenance/cleanup`);
    if (cron.status !== 401)
      throw new Error('Cleanup endpoint must reject an unsigned request');
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
      'base64',
    );
    const grantResponse = await fetch(`${origin}/api/uploads/direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'production',
        contentType: 'image/png',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }),
    });
    if (!grantResponse.ok)
      throw new Error(`Upload authorization failed: ${grantResponse.status}`);
    const grant = (await grantResponse.json()) as {
      token: string;
      url: string;
      fields: Record<string, string>;
    };
    const storagePreflight = await fetch(grant.url, {
      method: 'OPTIONS',
      headers: {
        Origin: browserOrigin,
        'Access-Control-Request-Method': 'POST',
      },
    });
    if (
      storagePreflight.headers.get('access-control-allow-origin') !==
      browserOrigin
    )
      throw new Error('Storage browser upload origin is not allowed');
    keys.push(
      (
        JSON.parse(
          Buffer.from(grant.token.split('.')[0], 'base64url').toString(),
        ) as { key: string }
      ).key,
    );
    const body = new FormData();
    for (const [key, value] of Object.entries(grant.fields))
      body.append(key, value);
    body.append('file', new Blob([bytes], { type: 'image/png' }), 'check.png');
    const upload = await fetch(grant.url, { method: 'POST', body });
    if (!upload.ok)
      throw new Error(`Direct file transfer failed: ${upload.status}`);
    const complete = await fetch(`${origin}/api/uploads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purpose: 'POLAROID_FINAL',
        uploadToken: grant.token,
      }),
    });
    if (!complete.ok)
      throw new Error(`File validation failed: ${complete.status}`);
    const file = (await complete.json()) as { key: string; url: string };
    keys.push(file.key);
    const download = await fetch(file.url, { redirect: 'manual' });
    if (
      download.status !== 302 ||
      !download.headers.get('location')?.includes('.neon.tech')
    )
      throw new Error(
        'API did not redirect the download to private Neon storage',
      );
    const final = await fetch(download.headers.get('location')!);
    if (!Buffer.from(await final.arrayBuffer()).equals(bytes))
      throw new Error('Downloaded artwork differs from the upload');
    console.log(
      'PASS: isolated Vercel-mode API, direct upload authorization/transfer/finalization, signed artwork download, gallery/reviews, protected cron.',
    );
  } finally {
    server.kill('SIGTERM');
    await Promise.all(
      keys.map((Key) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket(), Key })),
      ),
    );
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Runtime verification failed',
  );
  process.exitCode = 1;
});
