import { Module } from '@nestjs/common';
import { ImageProcessorService } from './image-processor.service';
import { MediaTokenService } from './media-token.service';
import { StorageCleanupService } from './storage-cleanup.service';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  providers: [ImageProcessorService, MediaTokenService, StorageCleanupService],
  exports: [ImageProcessorService, MediaTokenService, StorageCleanupService],
})
export class MediaModule {}
