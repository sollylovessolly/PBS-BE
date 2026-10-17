import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GalleryService } from './gallery.service';

@Injectable()
export class GalleryCleanupService implements OnModuleInit {
  private readonly logger = new Logger(GalleryCleanupService.name);
  constructor(
    private readonly gallery: GalleryService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (process.env.VERCEL) return;
    const configured = Number(
      this.config.get('GALLERY_ORPHAN_CLEANUP_INTERVAL_MS', 3_600_000),
    );
    const interval =
      Number.isFinite(configured) && configured >= 60_000
        ? configured
        : 3_600_000;
    const timer = setInterval(() => {
      void this.gallery.cleanupExpiredUploads().catch((error: unknown) => {
        this.logger.error({
          event: 'gallery_orphan_cleanup_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
    }, interval);
    timer.unref();
  }
}
