import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { UploadPurpose } from '../upload-purpose';

export class UploadFileDto {
  @ApiProperty({ enum: UploadPurpose, example: UploadPurpose.POLAROID_FINAL })
  @IsEnum(UploadPurpose)
  purpose!: UploadPurpose;

  @IsOptional() @IsString() @MaxLength(2048) uploadToken?: string;
}
