import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { GalleryAlbumStatus } from '../../generated/prisma/client';

export class GalleryListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class FeaturedQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) limit?: number;
}

export class GalleryUploadDto {
  @IsUUID() requestKey!: string;
  @IsOptional() @IsString() @MaxLength(2048) uploadToken?: string;
}

export class GalleryAlbumPhotoDto {
  @IsString() @MinLength(1) id!: string;
  @IsString() @MaxLength(300) caption!: string;
  @IsString() @MaxLength(300) alt!: string;
  @IsBoolean() featured!: boolean;
}

export class CreateGalleryAlbumDto {
  @IsUUID() requestKey!: string;
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MaxLength(2000) description!: string;
  @IsEnum(GalleryAlbumStatus) status!: GalleryAlbumStatus;
  @IsBoolean() permissionConfirmed!: boolean;
  @IsOptional() @IsString() coverPhotoId!: string | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GalleryAlbumPhotoDto)
  photos!: GalleryAlbumPhotoDto[];
}

export class UpdateGalleryAlbumDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(1) @MaxLength(120) title!: string;
  @IsString() @MaxLength(2000) description!: string;
  @IsEnum(GalleryAlbumStatus) status!: GalleryAlbumStatus;
  @IsBoolean() permissionConfirmed!: boolean;
  @IsOptional() @IsString() coverPhotoId!: string | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GalleryAlbumPhotoDto)
  photos!: GalleryAlbumPhotoDto[];
}

export class VersionDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
