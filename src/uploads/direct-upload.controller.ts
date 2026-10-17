import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../security/rate-limit.decorator';
import { DirectUploadDto, DirectUploadService } from './direct-upload.service';

@Controller('uploads/direct')
export class DirectUploadController {
  constructor(private readonly uploads: DirectUploadService) {}

  @Public()
  @Post()
  @RateLimit('UPLOAD_RATE_LIMIT_PER_MINUTE', 10)
  initiate(@Body() body: DirectUploadDto) {
    return this.uploads.initiate(body);
  }

  @Post('admin')
  @RateLimit('GALLERY_UPLOAD_RATE_LIMIT_PER_MINUTE', 20)
  initiateAdmin(
    @Req() request: Request & { admin: { id: string } },
    @Body() body: DirectUploadDto,
  ) {
    return this.uploads.initiate(
      body,
      body.kind === 'gallery' ? request.admin.id : undefined,
    );
  }
}
