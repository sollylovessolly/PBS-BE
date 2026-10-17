import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  DirectUploadService,
  type DirectUploadDto,
} from './direct-upload.service';
import { NeonStorageService } from './neon-storage.service';

describe('DirectUploadService', () => {
  const bytes = Buffer.from('89504e470d0a1a0a', 'hex');
  const input: DirectUploadDto = {
    kind: 'production',
    contentType: 'image/png',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  let service: DirectUploadService;
  let storage: {
    directUpload: jest.Mock;
    download: jest.Mock;
    delete: jest.Mock;
  };
  beforeEach(() => {
    storage = {
      directUpload: jest.fn().mockResolvedValue({
        url: 'https://storage.example',
        fields: { key: 'incoming/test' },
      }),
      download: jest
        .fn()
        .mockResolvedValue({ body: bytes, contentType: 'image/png' }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const values: Record<string, string> = {
      STORAGE_PROVIDER: 'neon',
      JWT_SECRET: 'test-secret-with-at-least-32-characters',
    };
    service = new DirectUploadService(
      storage as unknown as NeonStorageService,
      {
        get: (key: string) => values[key],
      } as ConfigService,
    );
  });

  it('authorizes an exact file and verifies its bytes before use', async () => {
    const grant = await service.initiate(input);
    const file = await service.read(grant.token, 'production');
    expect(file.buffer).toEqual(bytes);
    expect(storage.directUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^incoming\//),
      'image/png',
      bytes.length,
    );
    await service.discard(grant.token, 'production');
    expect(storage.delete).toHaveBeenCalledWith(
      expect.stringMatching(/^incoming\//),
    );
  });

  it('rejects tampering, wrong contexts, and file replacement', async () => {
    const grant = await service.initiate(input);
    await expect(service.read(grant.token + 'x', 'production')).rejects.toThrow(
      'Invalid upload authorization',
    );
    await expect(service.read(grant.token, 'review')).rejects.toThrow(
      'another upload',
    );
    storage.download.mockResolvedValue({
      body: Buffer.from('changed!'),
      contentType: 'image/png',
    });
    await expect(service.read(grant.token, 'production')).rejects.toThrow(
      'does not match',
    );
  });

  it('binds gallery authorization to the authenticated admin', async () => {
    await expect(
      service.initiate({ ...input, kind: 'gallery' }),
    ).rejects.toThrow('admin access');
    const grant = await service.initiate(
      { ...input, kind: 'gallery' },
      'admin-1',
    );
    await expect(
      service.read(grant.token, 'gallery', 'admin-2'),
    ).rejects.toThrow('another upload');
    await expect(
      service.read(grant.token, 'gallery', 'admin-1'),
    ).resolves.toMatchObject({ size: bytes.length });
  });

  it('rejects expired grants and over-limit review files', async () => {
    const grant = await service.initiate(input);
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
    try {
      await expect(service.read(grant.token, 'production')).rejects.toThrow(
        'expired',
      );
    } finally {
      now.mockRestore();
    }
    await expect(
      service.initiate({ ...input, kind: 'review', size: 6_000_000 }),
    ).rejects.toThrow('allowed size');
  });
});
