import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class MediaTokenService {
  constructor(private readonly config: ConfigService) {}

  sign(scope: string, id: string, variant: string, ttlSeconds = 900) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const value = `${scope}:${id}:${variant}:${expires}`;
    const signature = this.mac(value);
    return Buffer.from(`${expires}.${signature}`).toString('base64url');
  }

  verify(
    token: string | undefined,
    scope: string,
    id: string,
    variant: string,
  ) {
    if (!token) return false;
    let decoded = '';
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return false;
    }
    const [expiresText, signature] = decoded.split('.');
    const expires = Number(expiresText);
    if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000))
      return false;
    const expected = this.mac(`${scope}:${id}:${variant}:${expires}`);
    const left = Buffer.from(signature ?? '');
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private mac(value: string) {
    return createHmac(
      'sha256',
      this.config.get<string>('JWT_SECRET', 'development-secret'),
    )
      .update(value)
      .digest('base64url');
  }
}
