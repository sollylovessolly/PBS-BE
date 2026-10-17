import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../security/rate-limit.decorator';
import {
  CreateGalleryAlbumDto,
  FeaturedQueryDto,
  GalleryListQueryDto,
  GalleryUploadDto,
  UpdateGalleryAlbumDto,
  VersionDto,
} from './dto/gallery.dto';
import { GalleryService } from './gallery.service';
import { MultipartExceptionFilter } from '../media/multipart-exception.filter';
import { DirectUploadService } from '../uploads/direct-upload.service';

type AdminRequest = Request & { admin: { id: string } };

@Public()
@ApiTags('Gallery — Public')
@Controller('gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Get('albums')
  albums(@Query() query: GalleryListQueryDto) {
    return this.gallery.publicAlbums(query.page ?? 1, query.limit ?? 12);
  }

  @Get('featured')
  featured(@Query() query: FeaturedQueryDto) {
    return this.gallery.featured(query.limit ?? 12);
  }

  @Get('albums/:slug')
  album(@Param('slug') slug: string) {
    return this.gallery.publicAlbum(slug);
  }

  @Get('media/:photoId/:variant')
  async media(
    @Param('photoId') photoId: string,
    @Param('variant') variant: string,
    @Query('token') token?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (variant !== 'full' && variant !== 'thumb')
      return this.gallery.media(photoId, 'full', 'invalid');
    const file = await this.gallery.media(photoId, variant, token);
    if ('redirectUrl' in file) {
      response?.setHeader('Cache-Control', 'private, no-store');
      response?.redirect(302, file.redirectUrl);
      return;
    }
    response?.setHeader(
      'Cache-Control',
      token ? 'private, no-store' : 'public, max-age=60',
    );
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: 'inline',
    });
  }
}

@ApiBearerAuth()
@ApiTags('Gallery — Admin')
@Controller('admin/gallery')
export class GalleryAdminController {
  constructor(
    private readonly gallery: GalleryService,
    private readonly direct: DirectUploadService,
  ) {}

  @Get('albums')
  albums(@Query() query: GalleryListQueryDto) {
    return this.gallery.adminAlbums(query.page ?? 1, query.limit ?? 20);
  }

  @Get('albums/:id')
  album(@Param('id') id: string) {
    return this.gallery.adminAlbum(id);
  }

  @Post('uploads')
  @RateLimit('GALLERY_UPLOAD_RATE_LIMIT_PER_MINUTE', 20)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'requestKey'],
      properties: {
        file: { type: 'string', format: 'binary' },
        requestKey: { type: 'string', format: 'uuid' },
      },
    },
  })
  @UseFilters(MultipartExceptionFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @Req() request: AdminRequest,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
    @Body() body: GalleryUploadDto,
  ) {
    if (file && body.uploadToken)
      throw new BadRequestException('Send either a file or an upload token');
    const uploaded = body.uploadToken
      ? await this.direct.read(body.uploadToken, 'gallery', request.admin.id)
      : file;
    try {
      return await this.gallery.upload(
        request.admin,
        uploaded,
        body.requestKey,
      );
    } finally {
      if (body.uploadToken)
        await this.direct
          .discard(body.uploadToken, 'gallery', request.admin.id)
          .catch(() => undefined);
    }
  }

  @Post('albums')
  create(@Req() request: AdminRequest, @Body() body: CreateGalleryAlbumDto) {
    return this.gallery.create(request.admin, body);
  }

  @Patch('albums/:id')
  update(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: UpdateGalleryAlbumDto,
  ) {
    return this.gallery.update(request.admin, id, body);
  }

  @Delete('albums/:id')
  @HttpCode(204)
  async remove(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: VersionDto,
  ) {
    await this.gallery.remove(request.admin, id, body.expectedVersion);
  }

  @Post('cleanup-orphans')
  cleanup() {
    return this.gallery.cleanupExpiredUploads();
  }
}
