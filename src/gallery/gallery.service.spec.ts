/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { GalleryAlbumStatus } from '../generated/prisma/client';
import { GalleryService } from './gallery.service';

describe('GalleryService', () => {
  const config = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  } as any;
  const images = { process: jest.fn() } as any;
  const tokens = { sign: jest.fn(() => 'signed'), verify: jest.fn() } as any;
  const cleanup = { queue: jest.fn(), run: jest.fn() } as any;
  const storage = {
    upload: jest.fn(),
    download: jest.fn(),
    delete: jest.fn(),
  } as any;

  it('queries only publishable albums and omits admin fields publicly', async () => {
    const album = {
      id: 'a1',
      slug: 'event',
      title: 'Event',
      description: '',
      status: 'PUBLISHED',
      permissionConfirmed: true,
      publishedAt: new Date(),
      coverPhoto: null,
      _count: { photos: 2 },
    };
    const prisma = {
      galleryAlbum: {
        findMany: jest.fn().mockResolvedValue([album]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as any;
    const service = new GalleryService(
      prisma,
      config,
      images,
      tokens,
      cleanup,
      storage,
    );
    const result = await service.publicAlbums();
    expect(prisma.galleryAlbum.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PUBLISHED', permissionConfirmed: true },
      }),
    );
    expect(result.data[0]).not.toHaveProperty('status');
    expect(result.pagination).toEqual({
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
    });
  });

  it('rejects publishing without photos, cover and permission before mutation', async () => {
    const prisma = {
      galleryAlbum: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const service = new GalleryService(
      prisma,
      config,
      images,
      tokens,
      cleanup,
      storage,
    );
    await expect(
      service.create(
        { id: 'admin' },
        {
          requestKey: '31f68c76-f0a0-45eb-b660-e617758969ab',
          title: 'Event',
          description: '',
          status: GalleryAlbumStatus.PUBLISHED,
          permissionConfirmed: false,
          coverPhotoId: null,
          photos: [],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns an idempotent upload and rejects key reuse with different bytes', async () => {
    const prisma = {
      galleryPhoto: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          contentFingerprint: 'different',
          width: 1,
          height: 1,
          caption: '',
          alt: '',
          featured: false,
        }),
      },
    } as any;
    const service = new GalleryService(
      prisma,
      config,
      images,
      tokens,
      cleanup,
      storage,
    );
    await expect(
      service.upload(
        { id: 'admin' },
        { buffer: Buffer.from('new bytes'), size: 9 },
        '31f68c76-f0a0-45eb-b660-e617758969ab',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
