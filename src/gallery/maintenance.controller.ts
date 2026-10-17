import {
  Controller,
  Get,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/public.decorator';
import { NeonStorageService } from '../uploads/neon-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { GalleryService } from './gallery.service';

@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly storage: NeonStorageService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('cleanup')
  async cleanup(@Headers('authorization') authorization?: string) {
    const secret = this.config.get<string>('CRON_SECRET');
    const expected = `Bearer ${secret ?? ''}`;
    if (
      !secret ||
      !authorization ||
      Buffer.byteLength(authorization) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
    )
      throw new UnauthorizedException();
    const gallery = await this.gallery.cleanupExpiredUploads();
    const incoming =
      this.config.get('STORAGE_PROVIDER') === 'neon'
        ? await this.storage.cleanupIncoming()
        : { deleted: 0 };
    await this.prisma
      .$executeRaw`DELETE FROM "ApiRateLimit" WHERE "resetAt" < NOW()`;
    return { gallery, incoming };
  }
}
