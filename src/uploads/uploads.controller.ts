import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { UploadFileDto } from './dto/upload-file.dto';
import { UploadedFileData, UploadsService } from './uploads.service';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../security/rate-limit.decorator';
import { DirectUploadService } from './direct-upload.service';

@Public()
@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly direct: DirectUploadService,
  ) {}

  @Post()
  @RateLimit('UPLOAD_RATE_LIMIT_PER_MINUTE', 10)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 20_000_000 } }),
  )
  @ApiOperation({ summary: 'Upload a validated production file' })
  @ApiCreatedResponse({
    schema: {
      example: {
        key: 'production/polaroid_final/uuid.png',
        url: 'https://api.example.com/api/uploads/files/opaque-token',
      },
    },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'purpose'],
      properties: {
        file: { type: 'string', format: 'binary' },
        purpose: {
          type: 'string',
          enum: [
            'POLAROID_FINAL',
            'POLAROID_PREVIEW',
            'PHOTOSTRIP_FINAL',
            'VINTAGE_LETTER_FINAL',
          ],
        },
      },
    },
  })
  async upload(
    @UploadedFile() file: UploadedFileData | undefined,
    @Body() dto: UploadFileDto,
  ) {
    if (file && dto.uploadToken)
      throw new BadRequestException('Send either a file or an upload token');
    const uploaded = dto.uploadToken
      ? await this.direct.read(dto.uploadToken, 'production')
      : file;
    try {
      return await this.uploads.upload(uploaded, dto.purpose);
    } finally {
      if (dto.uploadToken)
        await this.direct
          .discard(dto.uploadToken, 'production')
          .catch(() => undefined);
    }
  }

  @Get('files/:token')
  @ApiOperation({
    summary: 'Download a production file by unguessable file token',
  })
  async download(
    @Param('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.uploads.download(token);
    if ('redirectUrl' in file) {
      response.setHeader('Cache-Control', 'private, no-store');
      response.redirect(302, file.redirectUrl);
      return;
    }
    return new StreamableFile(file.body, { type: file.contentType });
  }
}
