import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { FileStorage } from './file-storage';

@Injectable()
export class NeonStorageService implements FileStorage {
  private client?: S3Client;
  constructor(private readonly config: ConfigService) {}

  private connection() {
    const endpoint = this.config.get<string>('AWS_ENDPOINT_URL_S3');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY');
    if (!endpoint || !accessKeyId || !secretAccessKey)
      throw new ServiceUnavailableException('File storage is not configured');
    this.client ??= new S3Client({
      endpoint,
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    return {
      client: this.client,
      Bucket: this.config.get<string>(
        'NEON_STORAGE_BUCKET',
        'production-files',
      ),
    };
  }

  async upload(input: { key: string; contentType: string; body: Buffer }) {
    const { client, Bucket } = this.connection();
    await client.send(
      new PutObjectCommand({
        Bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
    return { key: input.key };
  }

  async download(key: string) {
    const { client, Bucket } = this.connection();
    const response = await client.send(
      new GetObjectCommand({ Bucket, Key: key }),
    );
    if (!response.Body)
      throw new ServiceUnavailableException('File is unavailable');
    return {
      body: Buffer.from(await response.Body.transformToByteArray()),
      contentType: response.ContentType ?? 'application/octet-stream',
    };
  }

  async downloadUrl(key: string) {
    const { client, Bucket } = this.connection();
    // Keep the bucket private. Each authorized backend read gets a short-lived URL.
    await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), {
      expiresIn: 300,
    });
  }

  async directUpload(key: string, contentType: string, size: number) {
    const { client, Bucket } = this.connection();
    return createPresignedPost(client, {
      Bucket,
      Key: key,
      Expires: 600,
      Fields: { 'Content-Type': contentType },
      Conditions: [
        ['eq', '$Content-Type', contentType],
        ['content-length-range', size, size],
      ],
    });
  }

  async delete(key: string) {
    const { client, Bucket } = this.connection();
    await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
  }

  async cleanupIncoming() {
    const { client, Bucket } = this.connection();
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cursor: string | undefined;
    let deleted = 0;
    // Bounded work for a serverless invocation. Fresh requests use random keys.
    for (let page = 0; page < 10; page++) {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket,
          Prefix: 'incoming/',
          MaxKeys: 100,
          ContinuationToken: cursor,
        }),
      );
      for (const object of result.Contents ?? []) {
        if (
          object.Key &&
          object.LastModified &&
          object.LastModified.getTime() < cutoff
        ) {
          await this.delete(object.Key);
          deleted++;
        }
      }
      cursor = result.NextContinuationToken;
      if (!cursor) break;
    }
    return { deleted };
  }
}
