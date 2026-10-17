import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { IsIn, IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { NeonStorageService } from './neon-storage.service';

export type DirectUploadKind = 'production' | 'gallery' | 'review';
export class DirectUploadDto {
  @IsIn(['production', 'gallery', 'review']) kind!: DirectUploadKind;
  @IsIn(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
  contentType!: string;
  @IsInt() @Min(1) @Max(20_000_000) size!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) sha256!: string;
}
type Claim = DirectUploadDto & {
  key: string;
  expires: number;
  actorId?: string;
};

@Injectable()
export class DirectUploadService {
  constructor(
    private readonly storage: NeonStorageService,
    private readonly config: ConfigService,
  ) {}

  async initiate(input: DirectUploadDto, actorId?: string) {
    if (this.config.get('STORAGE_PROVIDER') !== 'neon')
      throw new ServiceUnavailableException('Direct uploads are not enabled');
    if (input.kind === 'gallery' && !actorId)
      throw new BadRequestException('Gallery uploads require admin access');
    const max =
      input.kind === 'gallery'
        ? 10 * 1024 * 1024
        : input.kind === 'review'
          ? 5 * 1024 * 1024
          : 20_000_000;
    if (
      input.size > max ||
      (input.kind !== 'production' && input.contentType === 'application/pdf')
    )
      throw new BadRequestException('File exceeds the allowed size or type');
    const claim: Claim = {
      ...input,
      key: `incoming/${randomUUID()}`,
      actorId,
      expires: Math.floor(Date.now() / 1000) + 600,
    };
    const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return {
      token: `${payload}.${this.mac(payload)}`,
      ...(await this.storage.directUpload(
        claim.key,
        claim.contentType,
        claim.size,
      )),
    };
  }

  async read(token: string, kind: DirectUploadKind, actorId?: string) {
    const claim = this.verify(token, kind, actorId);
    const file = await this.storage.download(claim.key);
    if (
      file.body.length !== claim.size ||
      createHash('sha256').update(file.body).digest('hex') !== claim.sha256
    )
      throw new BadRequestException(
        'Uploaded file does not match its upload authorization',
      );
    return {
      buffer: file.body,
      mimetype: claim.contentType,
      size: file.body.length,
      fieldname: 'photos',
    };
  }

  async discard(token: string, kind: DirectUploadKind, actorId?: string) {
    const claim = this.verify(token, kind, actorId);
    await this.storage.delete(claim.key);
  }

  private verify(
    token: string,
    kind: DirectUploadKind,
    actorId?: string,
  ): Claim {
    const [payload, signature, extra] = token.split('.');
    const expected = this.mac(payload ?? '');
    if (
      extra ||
      !signature ||
      Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new BadRequestException('Invalid upload authorization');
    let claim: Claim;
    try {
      claim = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claim;
    } catch {
      throw new BadRequestException('Invalid upload authorization');
    }
    if (
      claim.kind !== kind ||
      claim.actorId !== actorId ||
      claim.expires <= Date.now() / 1000 ||
      !/^incoming\/[a-f0-9-]{36}$/.test(claim.key)
    )
      throw new BadRequestException(
        'Upload authorization has expired or belongs to another upload',
      );
    return claim;
  }

  private mac(value: string) {
    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret)
      throw new ServiceUnavailableException(
        'Upload authorization is not configured',
      );
    return createHmac('sha256', secret).update(value).digest('base64url');
  }
}
