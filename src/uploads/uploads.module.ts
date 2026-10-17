import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FILE_STORAGE } from './file-storage';
import { SupabaseStorageService } from './supabase-storage.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { NeonStorageService } from './neon-storage.service';
import { DirectUploadService } from './direct-upload.service';
import { DirectUploadController } from './direct-upload.controller';

@Module({
  controllers: [UploadsController, DirectUploadController],
  providers: [
    UploadsService,
    SupabaseStorageService,
    NeonStorageService,
    DirectUploadService,
    {
      provide: FILE_STORAGE,
      inject: [ConfigService, SupabaseStorageService, NeonStorageService],
      useFactory: (
        config: ConfigService,
        supabase: SupabaseStorageService,
        neon: NeonStorageService,
      ) => (config.get('STORAGE_PROVIDER') === 'neon' ? neon : supabase),
    },
  ],
  exports: [FILE_STORAGE, DirectUploadService, NeonStorageService],
})
export class UploadsModule {}
