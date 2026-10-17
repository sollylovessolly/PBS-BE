import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, ReviewStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PhoneNumberService } from '../customers/phone-number.service';
import { FILE_STORAGE } from '../uploads/file-storage';
import type { FileStorage } from '../uploads/file-storage';
import {
  ImageProcessorService,
  ProcessedImage,
} from '../media/image-processor.service';
import { MediaTokenService } from '../media/media-token.service';
import { StorageCleanupService } from '../media/storage-cleanup.service';
import { ModerateReviewDto, SubmitReviewDto } from './dto/review.dto';

type UploadFile = { buffer: Buffer; size: number; fieldname: string };
type Actor = { id: string };
type ReviewWithPhotos = Prisma.ReviewGetPayload<{
  include: { photos: true };
}>;
type ReviewPhotoRecord = ReviewWithPhotos['photos'][number];

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly phoneNumbers: PhoneNumberService,
    private readonly images: ImageProcessorService,
    private readonly tokens: MediaTokenService,
    private readonly cleanup: StorageCleanupService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async publicList(page = 1, limit = 12) {
    const where = {
      status: ReviewStatus.PUBLISHED,
      publicationConsent: true,
    } as const;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);
    return this.page(
      rows.map((row) => this.publicDto(row)),
      total,
      page,
      limit,
    );
  }

  async submit(input: SubmitReviewDto, files: UploadFile[]) {
    if (
      input.publicationConsent !== 'true' ||
      input.consentVersion !== 'review-publication-v1'
    )
      throw new ForbiddenException('Website publication consent is required');
    if (files.length > 3)
      throw new BadRequestException(
        'A review can include at most three photos',
      );
    if (files.some((file) => file.fieldname !== 'photos'))
      throw new BadRequestException('Unexpected file field');
    const normalized = {
      displayName: input.displayName.trim(),
      rating: Number(input.rating),
      text: input.text.trim(),
      phone: this.phoneNumbers.normalizeNigerian(input.phone),
      orderNumber: input.orderNumber?.trim() || null,
      publicationConsent: true,
      consentVersion: 'review-publication-v1',
      fileHashes: files.map((file) =>
        createHash('sha256').update(file.buffer).digest('hex'),
      ),
    };
    if (!normalized.displayName || normalized.text.length < 10)
      throw new BadRequestException(
        'Display name and a review of at least 10 characters are required',
      );
    if (!/^\+?[0-9]{10,15}$/.test(normalized.phone.replace(/\s/g, '')))
      throw new BadRequestException('Phone must be a valid phone number');
    const fingerprint = this.hash(normalized);
    const existing = await this.prisma.review.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (existing) {
      if (existing.submissionFingerprint !== fingerprint)
        throw new ConflictException(
          'requestKey was already used for another review',
        );
      return { id: existing.id, status: ReviewStatus.PENDING };
    }

    const processed: ProcessedImage[] = [];
    for (const file of files)
      processed.push(await this.images.process(file.buffer, 5 * 1024 * 1024));
    const objects: {
      fullKey: string;
      thumbnailKey: string;
      image: ProcessedImage;
      order: number;
    }[] = [];
    const uploaded: string[] = [];
    try {
      for (let index = 0; index < processed.length; index++) {
        const image = processed[index];
        const nonce = randomUUID();
        const fullKey = `reviews/${nonce}/full.${image.extension}`;
        const thumbnailKey = `reviews/${nonce}/thumb.${image.extension}`;
        await this.storage.upload({
          key: fullKey,
          contentType: image.mimeType,
          body: image.full,
        });
        uploaded.push(fullKey);
        await this.storage.upload({
          key: thumbnailKey,
          contentType: image.mimeType,
          body: image.thumbnail,
        });
        uploaded.push(thumbnailKey);
        objects.push({ fullKey, thumbnailKey, image, order: index });
      }
      const review = await this.prisma.review.create({
        data: {
          displayName: normalized.displayName,
          rating: normalized.rating,
          text: normalized.text,
          phone: normalized.phone,
          orderNumber: normalized.orderNumber,
          publicationConsent: true,
          consentVersion: normalized.consentVersion,
          consentedAt: new Date(),
          requestKey: input.requestKey,
          submissionFingerprint: fingerprint,
          verifiedPurchase: false,
          photos: {
            create: objects.map((object) => ({
              fullKey: object.fullKey,
              thumbnailKey: object.thumbnailKey,
              mimeType: object.image.mimeType,
              byteSize: object.image.byteSize,
              width: object.image.width,
              height: object.image.height,
              sortOrder: object.order,
            })),
          },
        },
      });
      return { id: review.id, status: ReviewStatus.PENDING };
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => this.storage.delete(key)));
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.review.findUnique({
          where: { requestKey: input.requestKey },
        });
        if (raced?.submissionFingerprint === fingerprint)
          return { id: raced.id, status: ReviewStatus.PENDING };
        throw new ConflictException(
          'requestKey was already used for another review',
        );
      }
      throw error;
    }
  }

  async adminList(
    status: ReviewStatus = ReviewStatus.PENDING,
    page = 1,
    limit = 20,
  ) {
    const where = { status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.review.count({ where }),
    ]);
    return this.page(
      rows.map((row) => this.adminDto(row)),
      total,
      page,
      limit,
    );
  }

  async moderate(actor: Actor, id: string, input: ModerateReviewDto) {
    const reason = input.moderationReason?.trim() || null;
    if (input.status === ReviewStatus.REJECTED && !reason)
      throw new BadRequestException('A rejection reason is required');
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Review" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.review.findUnique({
        where: { id },
        include: { photos: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!current) throw new NotFoundException('Review was not found');
      if (current.version !== input.expectedVersion)
        throw new ConflictException(
          'Review was changed elsewhere. Reload and try again.',
        );
      if (
        input.status === ReviewStatus.PUBLISHED &&
        !current.publicationConsent
      )
        throw new ForbiddenException(
          'Review does not have publication consent',
        );
      const row = await tx.review.update({
        where: { id },
        data: {
          status: input.status,
          moderationReason: reason,
          moderatedById: actor.id,
          moderatedAt: new Date(),
          version: { increment: 1 },
        },
        include: { photos: { orderBy: { sortOrder: 'asc' } } },
      });
      await tx.reviewAudit.create({
        data: {
          reviewId: id,
          actorId: actor.id,
          priorStatus: current.status,
          newStatus: input.status,
          reason,
        },
      });
      return row;
    });
    return this.adminDto(updated);
  }

  async remove(actor: Actor, id: string, expectedVersion: number) {
    const keys = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Review" WHERE "id" = ${id} FOR UPDATE`;
      const review = await tx.review.findUnique({
        where: { id },
        include: { photos: true },
      });
      if (!review) return [] as string[];
      if (review.version !== expectedVersion)
        throw new ConflictException(
          'Review was changed elsewhere. Reload and try again.',
        );
      await tx.review.update({
        where: { id },
        data: { status: ReviewStatus.REJECTED },
      });
      const objectKeys = review.photos.flatMap((photo) => [
        photo.fullKey,
        photo.thumbnailKey,
      ]);
      await tx.contentDeletionAudit.create({
        data: { entityType: 'REVIEW', entityId: id, actorId: actor.id },
      });
      await this.cleanup.queue(tx, objectKeys, 'REVIEW');
      await tx.review.delete({ where: { id } });
      return objectKeys;
    });
    if (keys.length) await this.cleanup.run();
  }

  async media(photoId: string, variant: 'full' | 'thumb', token?: string) {
    const photo = await this.prisma.reviewPhoto.findUnique({
      where: { id: photoId },
      include: { review: true },
    });
    if (!photo) throw new NotFoundException('Media is unavailable');
    const isPublic =
      photo.review.status === ReviewStatus.PUBLISHED &&
      photo.review.publicationConsent;
    if (!isPublic && !this.tokens.verify(token, 'review', photo.id, variant))
      throw new NotFoundException('Media is unavailable');
    const key = variant === 'full' ? photo.fullKey : photo.thumbnailKey;
    return this.storage.downloadUrl
      ? { redirectUrl: await this.storage.downloadUrl(key) }
      : this.storage.download(key);
  }

  private publicDto(review: ReviewWithPhotos) {
    return {
      id: review.id,
      displayName: review.displayName,
      rating: review.rating,
      text: review.text,
      createdAt: review.createdAt.toISOString(),
      verifiedPurchase: review.verifiedPurchase,
      photos: review.photos.map((photo) => this.photoDto(photo, false)),
    };
  }

  private adminDto(review: ReviewWithPhotos) {
    return {
      ...this.publicDto({ ...review, photos: [] }),
      status: review.status,
      version: review.version,
      phone: review.phone,
      orderNumber: review.orderNumber,
      publicationConsent: review.publicationConsent,
      moderationReason: review.moderationReason,
      photos: review.photos.map((photo) => this.photoDto(photo, true)),
    };
  }

  private photoDto(photo: ReviewPhotoRecord, signed: boolean) {
    const token = (variant: string) =>
      signed ? `?token=${this.tokens.sign('review', photo.id, variant)}` : '';
    return {
      id: photo.id,
      url: this.url(`/api/reviews/media/${photo.id}/full${token('full')}`),
      thumbnailUrl: this.url(
        `/api/reviews/media/${photo.id}/thumb${token('thumb')}`,
      ),
    };
  }

  private page<T>(data: T[], total: number, page: number, limit: number) {
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
  private url(path: string) {
    return `${this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000').replace(/\/$/, '')}${path}`;
  }
}
