import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { GalleryAlbumStatus, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE } from '../uploads/file-storage';
import type { FileStorage } from '../uploads/file-storage';
import { ImageProcessorService } from '../media/image-processor.service';
import { MediaTokenService } from '../media/media-token.service';
import { StorageCleanupService } from '../media/storage-cleanup.service';
import {
  CreateGalleryAlbumDto,
  GalleryAlbumPhotoDto,
  UpdateGalleryAlbumDto,
} from './dto/gallery.dto';

type AdminActor = { id: string };
type UploadFile = { buffer: Buffer; size: number };
type GalleryAlbumWithPhotos = Prisma.GalleryAlbumGetPayload<{
  include: { photos: true };
}>;

@Injectable()
export class GalleryService {
  private readonly logger = new Logger(GalleryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly images: ImageProcessorService,
    private readonly tokens: MediaTokenService,
    private readonly cleanup: StorageCleanupService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  async publicAlbums(page = 1, limit = 12) {
    const where = {
      status: GalleryAlbumStatus.PUBLISHED,
      permissionConfirmed: true,
    } as const;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.galleryAlbum.findMany({
        where,
        include: { coverPhoto: true, _count: { select: { photos: true } } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.galleryAlbum.count({ where }),
    ]);
    return this.page(
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        photoCount: row._count.photos,
        cover: row.coverPhoto ? this.publicPhoto(row.coverPhoto) : null,
      })),
      total,
      page,
      limit,
    );
  }

  async publicAlbum(slug: string) {
    const album = await this.prisma.galleryAlbum.findFirst({
      where: {
        slug,
        status: GalleryAlbumStatus.PUBLISHED,
        permissionConfirmed: true,
      },
      include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    if (!album) throw new NotFoundException('Album is unavailable');
    return {
      id: album.id,
      slug: album.slug,
      title: album.title,
      description: album.description,
      coverPhotoId: album.coverPhotoId,
      photos: album.photos.map((photo) => this.publicPhoto(photo)),
      updatedAt: album.updatedAt.toISOString(),
    };
  }

  async featured(limit = 12) {
    const photos = await this.prisma.galleryPhoto.findMany({
      where: {
        featured: true,
        album: {
          is: {
            status: GalleryAlbumStatus.PUBLISHED,
            permissionConfirmed: true,
          },
        },
      },
      include: { album: true },
      orderBy: [
        { album: { publishedAt: 'desc' } },
        { sortOrder: 'asc' },
        { id: 'asc' },
      ],
      take: limit,
    });
    return photos.map((photo) => ({
      ...this.publicPhoto(photo),
      albumSlug: photo.album!.slug,
      albumTitle: photo.album!.title,
    }));
  }

  async adminAlbums(page = 1, limit = 20) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.galleryAlbum.findMany({
        include: { coverPhoto: true, _count: { select: { photos: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.galleryAlbum.count(),
    ]);
    return this.page(
      rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        status: row.status,
        photoCount: row._count.photos,
        cover: row.coverPhoto ? this.adminPhoto(row.coverPhoto) : null,
      })),
      total,
      page,
      limit,
    );
  }

  async adminAlbum(id: string) {
    const album = await this.prisma.galleryAlbum.findUnique({
      where: { id },
      include: { photos: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    });
    if (!album) throw new NotFoundException('Album was not found');
    return this.adminAlbumDto(album);
  }

  async upload(
    actor: AdminActor,
    file: UploadFile | undefined,
    requestKey: string,
  ) {
    if (!file)
      throw new BadRequestException('Exactly one image file is required');
    const fingerprint = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.galleryPhoto.findUnique({
      where: { uploaderId_requestKey: { uploaderId: actor.id, requestKey } },
    });
    if (existing) {
      if (existing.contentFingerprint !== fingerprint)
        throw new ConflictException(
          'requestKey was already used for another file',
        );
      return this.adminPhoto(existing);
    }
    const image = await this.images.process(file.buffer, 10 * 1024 * 1024);
    const nonce = randomUUID();
    const fullKey = `gallery/${actor.id}/${nonce}/full.${image.extension}`;
    const thumbnailKey = `gallery/${actor.id}/${nonce}/thumb.${image.extension}`;
    const uploaded: string[] = [];
    try {
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
      const photo = await this.prisma.galleryPhoto.create({
        data: {
          uploaderId: actor.id,
          requestKey,
          contentFingerprint: image.fingerprint,
          fullKey,
          thumbnailKey,
          mimeType: image.mimeType,
          byteSize: image.byteSize,
          width: image.width,
          height: image.height,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      return this.adminPhoto(photo);
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => this.storage.delete(key)));
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.galleryPhoto.findUnique({
          where: {
            uploaderId_requestKey: { uploaderId: actor.id, requestKey },
          },
        });
        if (raced?.contentFingerprint === image.fingerprint)
          return this.adminPhoto(raced);
        throw new ConflictException(
          'requestKey was already used for another file',
        );
      }
      throw error;
    }
  }

  async create(actor: AdminActor, input: CreateGalleryAlbumDto) {
    const normalized = this.normalizeAlbum(input);
    const fingerprint = this.hash(normalized);
    const existing = await this.prisma.galleryAlbum.findUnique({
      where: {
        createdById_createRequestKey: {
          createdById: actor.id,
          createRequestKey: input.requestKey,
        },
      },
    });
    if (existing) {
      if (
        existing.createdById !== actor.id ||
        existing.createFingerprint !== fingerprint
      )
        throw new ConflictException(
          'requestKey was already used with different album data',
        );
      return this.adminAlbum(existing.id);
    }
    this.assertPublishable(normalized);
    await this.assertPhotos(normalized.photos);
    const slug = await this.uniqueSlug(normalized.title);
    try {
      const album = await this.prisma.$transaction(async (tx) => {
        const created = await tx.galleryAlbum.create({
          data: {
            slug,
            title: normalized.title,
            description: normalized.description,
            status: normalized.status,
            permissionConfirmed: normalized.permissionConfirmed,
            permissionActorId: normalized.permissionConfirmed ? actor.id : null,
            permissionAt: normalized.permissionConfirmed ? new Date() : null,
            createRequestKey: input.requestKey,
            createFingerprint: fingerprint,
            createdById: actor.id,
            updatedById: actor.id,
            publishedAt:
              normalized.status === GalleryAlbumStatus.PUBLISHED
                ? new Date()
                : null,
          },
        });
        await this.attachPhotos(tx, created.id, normalized.photos);
        if (normalized.coverPhotoId)
          await tx.galleryAlbum.update({
            where: { id: created.id },
            data: { coverPhotoId: normalized.coverPhotoId },
          });
        await tx.galleryAudit.create({
          data: {
            albumId: created.id,
            actorId: actor.id,
            action: 'CREATED',
            newStatus: normalized.status,
            permissionConfirmed: normalized.permissionConfirmed,
          },
        });
        return created;
      });
      return this.adminAlbum(album.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.galleryAlbum.findUnique({
          where: {
            createdById_createRequestKey: {
              createdById: actor.id,
              createRequestKey: input.requestKey,
            },
          },
        });
        if (
          raced?.createdById === actor.id &&
          raced.createFingerprint === fingerprint
        )
          return this.adminAlbum(raced.id);
      }
      throw error;
    }
  }

  async update(actor: AdminActor, id: string, input: UpdateGalleryAlbumDto) {
    const normalized = this.normalizeAlbum(input);
    this.assertPublishable(normalized);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "GalleryAlbum" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.galleryAlbum.findUnique({
        where: { id },
        include: { photos: true },
      });
      if (!current) throw new NotFoundException('Album was not found');
      if (current.version !== input.expectedVersion)
        throw new ConflictException(
          'Album was changed elsewhere. Reload and try again.',
        );
      await this.assertPhotos(normalized.photos, id, tx);
      await tx.galleryAlbum.update({
        where: { id },
        data: { coverPhotoId: null },
      });
      await tx.galleryPhoto.updateMany({
        where: { albumId: id },
        data: {
          albumId: null,
          sortOrder: null,
          featured: false,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await this.attachPhotos(tx, id, normalized.photos);
      const publishedAt =
        normalized.status === GalleryAlbumStatus.PUBLISHED
          ? (current.publishedAt ?? new Date())
          : null;
      const changedPermission =
        normalized.permissionConfirmed !== current.permissionConfirmed;
      const updated = await tx.galleryAlbum.update({
        where: { id },
        data: {
          title: normalized.title,
          description: normalized.description,
          status: normalized.status,
          permissionConfirmed: normalized.permissionConfirmed,
          permissionActorId: normalized.permissionConfirmed
            ? changedPermission
              ? actor.id
              : current.permissionActorId
            : null,
          permissionAt: normalized.permissionConfirmed
            ? changedPermission
              ? new Date()
              : current.permissionAt
            : null,
          coverPhotoId: normalized.coverPhotoId,
          updatedById: actor.id,
          publishedAt,
          version: { increment: 1 },
        },
      });
      await tx.galleryAudit.create({
        data: {
          albumId: id,
          actorId: actor.id,
          action: 'UPDATED',
          priorStatus: current.status,
          newStatus: updated.status,
          permissionConfirmed: updated.permissionConfirmed,
        },
      });
      return updated;
    });
    return this.adminAlbum(result.id);
  }

  async remove(actor: AdminActor, id: string, expectedVersion: number) {
    const keys = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "GalleryAlbum" WHERE "id" = ${id} FOR UPDATE`;
      const album = await tx.galleryAlbum.findUnique({
        where: { id },
        include: { photos: true },
      });
      if (!album) return [] as string[];
      if (album.version !== expectedVersion)
        throw new ConflictException(
          'Album was changed elsewhere. Reload and try again.',
        );
      await tx.galleryAlbum.update({
        where: { id },
        data: { coverPhotoId: null, status: GalleryAlbumStatus.DRAFT },
      });
      await tx.galleryPhoto.updateMany({
        where: { albumId: id },
        data: { albumId: null, sortOrder: null, featured: false },
      });
      await tx.galleryAlbum.delete({ where: { id } });
      const objectKeys = album.photos.flatMap((photo) => [
        photo.fullKey,
        photo.thumbnailKey,
      ]);
      await tx.contentDeletionAudit.create({
        data: { entityType: 'GALLERY_ALBUM', entityId: id, actorId: actor.id },
      });
      await this.cleanup.queue(tx, objectKeys, 'GALLERY');
      await tx.galleryPhoto.deleteMany({
        where: { id: { in: album.photos.map((p) => p.id) }, albumId: null },
      });
      return objectKeys;
    });
    if (keys.length) await this.cleanup.run();
    this.logger.log({
      event: 'gallery_deleted',
      albumId: id,
      actorId: actor.id,
    });
  }

  async media(photoId: string, variant: 'full' | 'thumb', token?: string) {
    const photo = await this.prisma.galleryPhoto.findUnique({
      where: { id: photoId },
      include: { album: true },
    });
    if (!photo) throw new NotFoundException('Media is unavailable');
    const isPublic =
      photo.album?.status === GalleryAlbumStatus.PUBLISHED &&
      photo.album.permissionConfirmed;
    if (!isPublic && !this.tokens.verify(token, 'gallery', photo.id, variant))
      throw new NotFoundException('Media is unavailable');
    const key = variant === 'full' ? photo.fullKey : photo.thumbnailKey;
    return this.storage.downloadUrl
      ? { redirectUrl: await this.storage.downloadUrl(key) }
      : this.storage.download(key);
  }

  async cleanupExpiredUploads() {
    const rows = await this.prisma.galleryPhoto.findMany({
      where: { albumId: null, expiresAt: { lt: new Date() } },
      take: 100,
    });
    for (const row of rows) {
      await this.prisma.$transaction(async (tx) => {
        const removed = await tx.galleryPhoto.deleteMany({
          where: { id: row.id, albumId: null },
        });
        if (removed.count)
          await this.cleanup.queue(
            tx,
            [row.fullKey, row.thumbnailKey],
            'GALLERY',
          );
        return removed;
      });
    }
    await this.cleanup.run();
    return { deleted: rows.length };
  }

  private normalizeAlbum(input: CreateGalleryAlbumDto | UpdateGalleryAlbumDto) {
    const photos = input.photos.map((photo) => ({
      id: photo.id.trim(),
      caption: photo.caption.trim(),
      alt: photo.alt.trim(),
      featured: photo.featured,
    }));
    if (new Set(photos.map((photo) => photo.id)).size !== photos.length)
      throw new BadRequestException('Album contains duplicate photo IDs');
    const coverPhotoId = input.coverPhotoId?.trim() || null;
    if (coverPhotoId && !photos.some((photo) => photo.id === coverPhotoId))
      throw new BadRequestException('Cover photo must belong to the album');
    return {
      title: input.title.trim(),
      description: input.description.trim(),
      status: input.status,
      permissionConfirmed: input.permissionConfirmed,
      coverPhotoId,
      photos,
    };
  }

  private assertPublishable(
    input: ReturnType<GalleryService['normalizeAlbum']>,
  ) {
    if (!input.title) throw new BadRequestException('Album title is required');
    if (input.status === GalleryAlbumStatus.PUBLISHED) {
      if (!input.photos.length)
        throw new BadRequestException(
          'Published albums require at least one photo',
        );
      if (!input.coverPhotoId)
        throw new BadRequestException('Published albums require a cover photo');
      if (!input.permissionConfirmed)
        throw new ForbiddenException(
          'Confirm publication rights before publishing',
        );
    }
    if (!input.photos.length && input.coverPhotoId)
      throw new BadRequestException('An empty album cannot have a cover photo');
  }

  private async assertPhotos(
    photos: GalleryAlbumPhotoDto[],
    albumId?: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (!photos.length) return;
    const rows = await db.galleryPhoto.findMany({
      where: { id: { in: photos.map((photo) => photo.id) } },
    });
    if (
      rows.length !== photos.length ||
      rows.some(
        (row) =>
          (row.albumId && row.albumId !== albumId) ||
          (!row.albumId && row.expiresAt && row.expiresAt < new Date()),
      )
    )
      throw new BadRequestException(
        'One or more gallery uploads are invalid, expired or unavailable',
      );
  }

  private async attachPhotos(
    tx: Prisma.TransactionClient,
    albumId: string,
    photos: GalleryAlbumPhotoDto[],
  ) {
    for (let index = 0; index < photos.length; index++) {
      const photo = photos[index];
      const changed = await tx.galleryPhoto.updateMany({
        where: { id: photo.id, OR: [{ albumId: null }, { albumId }] },
        data: {
          albumId,
          sortOrder: index,
          caption: photo.caption.trim(),
          alt: photo.alt.trim(),
          featured: photo.featured,
          expiresAt: null,
        },
      });
      if (!changed.count)
        throw new BadRequestException('A gallery photo is unavailable');
    }
  }

  private async uniqueSlug(title: string) {
    const base =
      title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 90) || 'album';
    let slug = base;
    for (
      let index = 0;
      await this.prisma.galleryAlbum.findUnique({
        where: { slug },
        select: { id: true },
      });
      index++
    )
      slug = `${base}-${index + 2}`;
    return slug;
  }

  private publicPhoto(photo: {
    id: string;
    width: number;
    height: number;
    caption: string;
    alt: string;
    featured: boolean;
  }) {
    return {
      id: photo.id,
      url: this.url(`/api/gallery/media/${photo.id}/full`),
      thumbnailUrl: this.url(`/api/gallery/media/${photo.id}/thumb`),
      width: photo.width,
      height: photo.height,
      caption: photo.caption,
      alt: photo.alt,
      featured: photo.featured,
    };
  }

  private adminPhoto(photo: {
    id: string;
    width: number;
    height: number;
    caption: string;
    alt: string;
    featured: boolean;
  }) {
    return {
      ...this.publicPhoto(photo),
      url: this.url(
        `/api/gallery/media/${photo.id}/full?token=${this.tokens.sign('gallery', photo.id, 'full')}`,
      ),
      thumbnailUrl: this.url(
        `/api/gallery/media/${photo.id}/thumb?token=${this.tokens.sign('gallery', photo.id, 'thumb')}`,
      ),
    };
  }

  private adminAlbumDto(album: GalleryAlbumWithPhotos) {
    return {
      id: album.id,
      slug: album.slug,
      title: album.title,
      description: album.description,
      status: album.status,
      version: album.version,
      permissionConfirmed: album.permissionConfirmed,
      coverPhotoId: album.coverPhotoId,
      photos: album.photos.map((photo) => this.adminPhoto(photo)),
      updatedAt: album.updatedAt.toISOString(),
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
