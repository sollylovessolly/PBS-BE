import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { UploadsModule } from '../uploads/uploads.module';
import {
  GalleryAdminController,
  GalleryController,
} from './gallery.controller';
import { GalleryService } from './gallery.service';
import { GalleryCleanupService } from './gallery-cleanup.service';
import { MaintenanceController } from './maintenance.controller';

@Module({
  imports: [UploadsModule, MediaModule],
  controllers: [
    GalleryController,
    GalleryAdminController,
    MaintenanceController,
  ],
  providers: [GalleryService, GalleryCleanupService],
})
export class GalleryModule {}
