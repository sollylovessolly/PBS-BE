import 'dotenv/config';
import { S3Client } from '@aws-sdk/client-s3';

export function storageClient() {
  for (const name of [
    'AWS_ENDPOINT_URL_S3',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
  ])
    if (!process.env[name]) throw new Error(`${name} is required`);
  return new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}
export const bucket = () =>
  process.env.NEON_STORAGE_BUCKET || 'production-files';
