import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export type ProcessedImage = {
  fingerprint: string;
  mimeType: string;
  extension: string;
  byteSize: number;
  width: number;
  height: number;
  full: Buffer;
  thumbnail: Buffer;
};

@Injectable()
export class ImageProcessorService {
  private readonly maxConcurrent = 2;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async process(buffer: Buffer, maxBytes: number): Promise<ProcessedImage> {
    await this.acquire();
    try {
      return await this.processImage(buffer, maxBytes);
    } finally {
      this.release();
    }
  }

  private async processImage(
    buffer: Buffer,
    maxBytes: number,
  ): Promise<ProcessedImage> {
    if (!buffer.length) throw new BadRequestException('Image file is empty');
    if (buffer.length > maxBytes)
      throw new PayloadTooLargeException('Image exceeds the upload size limit');

    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(buffer, {
        animated: false,
        limitInputPixels: 40_000_000,
        failOn: 'warning',
      }).metadata();
    } catch {
      throw new BadRequestException('Image is corrupt or exceeds safe limits');
    }
    if (!metadata.width || !metadata.height)
      throw new BadRequestException('Image dimensions are unavailable');
    if (metadata.width * metadata.height > 40_000_000)
      throw new BadRequestException('Image dimensions exceed safe limits');
    if ((metadata.pages ?? 1) > 1)
      throw new UnsupportedMediaTypeException(
        'Animated images are not supported',
      );
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? ''))
      throw new UnsupportedMediaTypeException(
        'Only JPEG, PNG and WebP images are supported',
      );

    const format = metadata.format as 'jpeg' | 'png' | 'webp';
    const oriented = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate();
    const encode = (pipeline: sharp.Sharp) => {
      if (format === 'jpeg')
        return pipeline.jpeg({ quality: 88, mozjpeg: true });
      if (format === 'webp') return pipeline.webp({ quality: 88 });
      return pipeline.png({ compressionLevel: 9 });
    };
    const full = await encode(
      oriented
        .clone()
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }),
    ).toBuffer();
    const thumbnail = await encode(
      oriented
        .clone()
        .resize(600, 600, { fit: 'inside', withoutEnlargement: true }),
    ).toBuffer();
    const output = await sharp(full).metadata();
    return {
      fingerprint: createHash('sha256').update(buffer).digest('hex'),
      mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
      extension: format === 'jpeg' ? 'jpg' : format,
      byteSize: buffer.length,
      width: output.width,
      height: output.height,
      full,
      thumbnail,
    };
  }

  private async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release() {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}
