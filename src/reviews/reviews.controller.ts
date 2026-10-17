import { AnyFilesInterceptor } from '@nestjs/platform-express';
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
  UploadedFiles,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ReviewStatus } from '../generated/prisma/client';
import { Public } from '../auth/public.decorator';
import { RateLimit } from '../security/rate-limit.decorator';
import {
  AdminReviewListQueryDto,
  ModerateReviewDto,
  ReviewListQueryDto,
  ReviewVersionDto,
  SubmitReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';
import { MultipartExceptionFilter } from '../media/multipart-exception.filter';
import { DirectUploadService } from '../uploads/direct-upload.service';

type AdminRequest = Request & { admin: { id: string } };
type UploadFile = { buffer: Buffer; size: number; fieldname: string };

@Public()
@ApiTags('Reviews — Public')
@Controller('reviews')
export class ReviewsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly direct: DirectUploadService,
  ) {}

  @Get()
  list(@Query() query: ReviewListQueryDto) {
    return this.reviews.publicList(query.page ?? 1, query.limit ?? 12);
  }

  @Post()
  @RateLimit('REVIEW_SUBMISSION_RATE_LIMIT_PER_MINUTE', 5)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: [
        'displayName',
        'rating',
        'text',
        'phone',
        'publicationConsent',
        'consentVersion',
        'requestKey',
      ],
      properties: {
        displayName: { type: 'string', maxLength: 80 },
        rating: { type: 'string', enum: ['1', '2', '3', '4', '5'] },
        text: { type: 'string', minLength: 10, maxLength: 2000 },
        phone: { type: 'string' },
        orderNumber: { type: 'string', maxLength: 100 },
        publicationConsent: { type: 'string', enum: ['true'] },
        consentVersion: {
          type: 'string',
          enum: ['review-publication-v1'],
        },
        requestKey: { type: 'string', format: 'uuid' },
        photos: {
          type: 'array',
          maxItems: 3,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseFilters(MultipartExceptionFilter)
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: { files: 4, fileSize: 5 * 1024 * 1024, fields: 8, parts: 12 },
    }),
  )
  async submit(
    @Body() body: SubmitReviewDto,
    @UploadedFiles() files: UploadFile[] = [],
  ) {
    if (files.length && body.uploadTokens?.length)
      throw new BadRequestException('Send either photos or upload tokens');
    const uploaded = body.uploadTokens
      ? await Promise.all(
          body.uploadTokens.map((token) => this.direct.read(token, 'review')),
        )
      : files;
    try {
      return await this.reviews.submit(body, uploaded);
    } finally {
      await Promise.allSettled(
        (body.uploadTokens ?? []).map((token) =>
          this.direct.discard(token, 'review'),
        ),
      );
    }
  }

  @Get('media/:photoId/:variant')
  async media(
    @Param('photoId') photoId: string,
    @Param('variant') variant: string,
    @Query('token') token?: string,
    @Res({ passthrough: true }) response?: Response,
  ) {
    if (variant !== 'full' && variant !== 'thumb')
      return this.reviews.media(photoId, 'full', 'invalid');
    const file = await this.reviews.media(photoId, variant, token);
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
@ApiTags('Reviews — Admin')
@Controller('admin/reviews')
export class ReviewsAdminController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() query: AdminReviewListQueryDto) {
    return this.reviews.adminList(
      query.status ?? ReviewStatus.PENDING,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  @Patch(':id')
  moderate(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: ModerateReviewDto,
  ) {
    return this.reviews.moderate(request.admin, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Req() request: AdminRequest,
    @Param('id') id: string,
    @Body() body: ReviewVersionDto,
  ) {
    await this.reviews.remove(request.admin, id, body.expectedVersion);
  }
}
