import sharp from 'sharp';
import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ImageProcessorService } from './image-processor.service';

describe('ImageProcessorService', () => {
  const service = new ImageProcessorService();

  it.each(['jpeg', 'png', 'webp'] as const)(
    'decodes, bounds and strips metadata from %s images',
    async (format) => {
      const input = await sharp({
        create: {
          width: 2400,
          height: 1200,
          channels: 3,
          background: '#ffccdd',
        },
      })
        .withMetadata({ exif: { IFD0: { Copyright: 'private metadata' } } })
        .toFormat(format)
        .toBuffer();
      const result = await service.process(input, 10 * 1024 * 1024);
      expect(result.mimeType).toBe(
        format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
      );
      expect(result.width).toBe(2000);
      expect(result.height).toBe(1000);
      const metadata = await sharp(result.full).metadata();
      expect(metadata.exif).toBeUndefined();
      const thumbnail = await sharp(result.thumbnail).metadata();
      expect(thumbnail.width).toBe(600);
    },
  );

  it('rejects corrupt, unsupported and oversized input', async () => {
    await expect(
      service.process(Buffer.from('not an image'), 100),
    ).rejects.toBeInstanceOf(BadRequestException);
    const gif = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
      'base64',
    );
    await expect(service.process(gif, 1000)).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    await expect(
      service.process(Buffer.alloc(101), 100),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });
});
