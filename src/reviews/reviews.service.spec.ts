/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReviewStatus } from '../generated/prisma/client';
import { ReviewsService } from './reviews.service';

describe('ReviewsService', () => {
  const config = {
    get: jest.fn((_key: string, fallback: string) => fallback),
  } as any;
  const phones = { normalizeNigerian: jest.fn(() => '+2348012345678') } as any;
  const images = { process: jest.fn() } as any;
  const tokens = { sign: jest.fn(() => 'signed'), verify: jest.fn() } as any;
  const cleanup = { queue: jest.fn(), run: jest.fn() } as any;
  const storage = {
    upload: jest.fn(),
    download: jest.fn(),
    delete: jest.fn(),
  } as any;
  const valid = {
    displayName: 'Ada O.',
    rating: '1',
    text: 'An honest low-rating review.',
    phone: '08012345678',
    orderNumber: '',
    publicationConsent: 'true',
    consentVersion: 'review-publication-v1',
    requestKey: '31f68c76-f0a0-45eb-b660-e617758969ab',
  };

  it('accepts an event review without an order and always creates it pending', async () => {
    const prisma = {
      review: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
      },
    } as any;
    const service = new ReviewsService(
      prisma,
      config,
      phones,
      images,
      tokens,
      cleanup,
      storage,
    );
    await expect(service.submit(valid, [])).resolves.toEqual({
      id: 'r1',
      status: 'PENDING',
    });
    const data = prisma.review.create.mock.calls[0][0].data;
    expect(data).toEqual(
      expect.objectContaining({ verifiedPurchase: false, orderNumber: null }),
    );
    expect(data).not.toHaveProperty('status');
  });

  it('replays the original pending receipt even after moderation', async () => {
    const firstPrisma = {
      review: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'r1' }),
      },
    } as any;
    const first = new ReviewsService(
      firstPrisma,
      config,
      phones,
      images,
      tokens,
      cleanup,
      storage,
    );
    await first.submit(valid, []);
    const fingerprint =
      firstPrisma.review.create.mock.calls[0][0].data.submissionFingerprint;
    const prisma = {
      review: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'r1',
          status: ReviewStatus.PUBLISHED,
          submissionFingerprint: fingerprint,
        }),
      },
    } as any;
    const service = new ReviewsService(
      prisma,
      config,
      phones,
      images,
      tokens,
      cleanup,
      storage,
    );
    await expect(service.submit(valid, [])).resolves.toEqual({
      id: 'r1',
      status: 'PENDING',
    });
  });

  it('rejects four photos and request-key reuse with changed testimony', async () => {
    const prisma = {
      review: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'r1', submissionFingerprint: 'other' }),
      },
    } as any;
    const service = new ReviewsService(
      prisma,
      config,
      phones,
      images,
      tokens,
      cleanup,
      storage,
    );
    const files = Array.from({ length: 4 }, () => ({
      buffer: Buffer.from('x'),
      size: 1,
      fieldname: 'photos',
    }));
    await expect(service.submit(valid, files)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.submit(valid, [])).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('requires a reason when rejecting testimony', async () => {
    const service = new ReviewsService(
      {} as any,
      config,
      phones,
      images,
      tokens,
      cleanup,
      storage,
    );
    await expect(
      service.moderate({ id: 'admin' }, 'r1', {
        expectedVersion: 1,
        status: ReviewStatus.REJECTED,
        moderationReason: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
