import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE } from '../uploads/file-storage';
import type { FileStorage } from '../uploads/file-storage';

@Injectable()
export class StorageCleanupService {
  private readonly logger = new Logger(StorageCleanupService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  queue(
    tx: Prisma.TransactionClient,
    keys: string[],
    purpose: 'GALLERY' | 'REVIEW',
  ) {
    if (!keys.length) return Promise.resolve({ count: 0 });
    return tx.storageCleanupJob.createMany({
      data: keys.map((objectKey) => ({ objectKey, purpose })),
      skipDuplicates: true,
    });
  }

  async run(limit = 100) {
    const jobs = await this.prisma.storageCleanupJob.findMany({
      where: { nextAttemptAt: { lte: new Date() } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    let deleted = 0;
    for (const job of jobs) {
      const expectedPrefix =
        job.purpose === 'GALLERY' ? 'gallery/' : 'reviews/';
      if (!job.objectKey.startsWith(expectedPrefix)) {
        await this.prisma.storageCleanupJob.delete({ where: { id: job.id } });
        continue;
      }
      const referenced =
        job.purpose === 'GALLERY'
          ? await this.prisma.galleryPhoto.count({
              where: {
                OR: [
                  { fullKey: job.objectKey },
                  { thumbnailKey: job.objectKey },
                ],
              },
            })
          : await this.prisma.reviewPhoto.count({
              where: {
                OR: [
                  { fullKey: job.objectKey },
                  { thumbnailKey: job.objectKey },
                ],
              },
            });
      if (referenced) continue;
      try {
        await this.storage.delete(job.objectKey);
        await this.prisma.storageCleanupJob.delete({ where: { id: job.id } });
        deleted += 1;
      } catch (error) {
        const attempts = job.attempts + 1;
        const delay = Math.min(
          24 * 60 * 60 * 1000,
          60_000 * 2 ** Math.min(attempts, 10),
        );
        await this.prisma.storageCleanupJob.update({
          where: { id: job.id },
          data: {
            attempts,
            lastError: error instanceof Error ? error.name : 'UnknownError',
            nextAttemptAt: new Date(Date.now() + delay),
          },
        });
        this.logger.error({
          event: 'storage_cleanup_failed',
          purpose: job.purpose,
          attempts,
        });
      }
    }
    return { processed: jobs.length, deleted };
  }
}
