import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';

import { FILE_STORAGE } from './file-storage';
import type { FileStorage } from './file-storage';
import { UploadPurpose } from './upload-purpose';

export type UploadedFileData = {
  buffer: Buffer;
  mimetype: string;
  size: number;
};

const allowedMimeTypes: Record<UploadPurpose, string[]> = {
  [UploadPurpose.POLAROID_FINAL]: ['image/png'],
  [UploadPurpose.POLAROID_PREVIEW]: ['image/png', 'image/jpeg', 'image/webp'],
  [UploadPurpose.PHOTOSTRIP_FINAL]: ['image/png'],
  [UploadPurpose.VINTAGE_LETTER_FINAL]: ['application/pdf'],
};

@Injectable()
export class UploadsService {
  constructor(
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly config: ConfigService,
  ) {}

  async upload(file: UploadedFileData | undefined, purpose: UploadPurpose) {
    if (!file) throw new BadRequestException('file is required');
    if (!allowedMimeTypes[purpose].includes(file.mimetype)) {
      throw new BadRequestException(`Invalid file type for ${purpose}`);
    }
    if (!this.matchesSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException('File contents do not match its MIME type');
    }
    const maxBytes = this.maxBytes(purpose);
    if (!file.size || file.size > maxBytes) {
      throw new BadRequestException(
        `File exceeds the ${Math.floor(maxBytes / 1_000_000)}MB limit`,
      );
    }

    const extension =
      file.mimetype === 'application/pdf'
        ? 'pdf'
        : file.mimetype === 'image/jpeg'
          ? 'jpg'
          : file.mimetype === 'image/webp'
            ? 'webp'
            : 'png';
    const key = `production/${purpose.toLowerCase()}/${randomUUID()}.${extension}`;
    const stored = await this.storage.upload({
      key,
      contentType: file.mimetype,
      body: file.buffer,
    });
    const publicApiUrl = this.config
      .get<string>('PUBLIC_API_URL', 'http://localhost:4000')
      .replace(/\/$/, '');
    return {
      key: stored.key,
      url: `${publicApiUrl}/api/uploads/files/${Buffer.from(stored.key).toString('base64url')}`,
    };
  }

  download(token: string) {
    let key: string;
    try {
      key = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('Invalid file token');
    }
    if (!key.startsWith('production/')) {
      throw new BadRequestException('Invalid file token');
    }
    return this.storage.downloadUrl
      ? this.storage.downloadUrl(key).then((redirectUrl) => ({ redirectUrl }))
      : this.storage.download(key);
  }

  private maxBytes(purpose: UploadPurpose) {
    const envName =
      purpose === UploadPurpose.POLAROID_PREVIEW
        ? 'MAX_PREVIEW_UPLOAD_BYTES'
        : purpose === UploadPurpose.VINTAGE_LETTER_FINAL
          ? 'MAX_PDF_UPLOAD_BYTES'
          : 'MAX_IMAGE_UPLOAD_BYTES';
    const fallback =
      purpose === UploadPurpose.POLAROID_PREVIEW
        ? 2_000_000
        : purpose === UploadPurpose.VINTAGE_LETTER_FINAL
          ? 20_000_000
          : 15_000_000;
    return this.config.get<number>(envName, fallback);
  }

  private matchesSignature(buffer: Buffer, mime: string) {
    if (mime === 'image/png')
      return buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    if (mime === 'image/jpeg')
      return buffer.subarray(0, 3).toString('hex') === 'ffd8ff';
    if (mime === 'image/webp') {
      return (
        buffer.subarray(0, 4).toString() === 'RIFF' &&
        buffer.subarray(8, 12).toString() === 'WEBP'
      );
    }
    if (mime === 'application/pdf')
      return buffer.subarray(0, 5).toString() === '%PDF-';
    return false;
  }
}
