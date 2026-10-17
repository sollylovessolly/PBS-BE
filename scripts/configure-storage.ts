import { PutBucketCorsCommand } from '@aws-sdk/client-s3';
import { bucket, storageClient } from './storage-client';

async function main() {
  const origins = [
    ...new Set(
      [
        process.env.FRONTEND_URL,
        process.env.ADMIN_FRONTEND_URL,
        process.env.ADDITIONAL_FRONTEND_ORIGINS,
      ]
        .filter(Boolean)
        .flatMap((value) =>
          value!
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        ),
    ),
  ];
  if (!origins.length)
    throw new Error('Set FRONTEND_URL before configuring upload origins');
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin)
      throw new Error(
        'Upload origins must be exact origins without a path or trailing slash',
      );
  }
  await storageClient().send(
    new PutBucketCorsCommand({
      Bucket: bucket(),
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ['POST', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log(
    `Private storage upload origins configured: ${origins.join(', ')}`,
  );
}
main().catch(() => {
  console.error(
    'Storage CORS setup failed; check credentials and exact frontend origins.',
  );
  process.exitCode = 1;
});
