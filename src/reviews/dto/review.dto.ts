import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ReviewStatus } from '../../generated/prisma/client';

export class ReviewListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class AdminReviewListQueryDto extends ReviewListQueryDto {
  @IsOptional() @IsEnum(ReviewStatus) status?: ReviewStatus;
}

export class SubmitReviewDto {
  @IsString() @MinLength(1) @MaxLength(80) displayName!: string;
  @IsString() @Matches(/^[1-5]$/) rating!: string;
  @IsString() @MinLength(10) @MaxLength(2000) text!: string;
  @IsString() @MinLength(10) @MaxLength(30) phone!: string;
  @IsOptional() @IsString() @MaxLength(100) orderNumber?: string;
  @IsString() publicationConsent!: string;
  @IsString() consentVersion!: string;
  @IsUUID() requestKey!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  uploadTokens?: string[];
}

export class ModerateReviewDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsEnum(ReviewStatus) status!: ReviewStatus;
  @IsOptional() @IsString() @MaxLength(1000) moderationReason!: string | null;
}

export class ReviewVersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
