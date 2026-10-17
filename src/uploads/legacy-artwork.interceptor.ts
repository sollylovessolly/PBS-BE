import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { map } from 'rxjs';

/** Keep saved order references usable after retiring the old API hostname. */
@Injectable()
export class LegacyArtworkInterceptor implements NestInterceptor {
  constructor(private readonly config: ConfigService) {}

  intercept(_context: ExecutionContext, next: CallHandler) {
    const current = this.config
      .get<string>('PUBLIC_API_URL')
      ?.replace(/\/$/, '');
    const legacy = this.config
      .get<string>('LEGACY_API_URL', 'https://polaroidsbysolly-be.onrender.com')
      .replace(/\/$/, '');
    return next.handle().pipe(
      map((value: unknown) => {
        if (!current || current === legacy) return value;
        return this.rewrite(
          value,
          `${legacy}/api/uploads/files/`,
          `${current}/api/uploads/files/`,
        );
      }),
    );
  }

  private rewrite(
    value: unknown,
    oldPrefix: string,
    newPrefix: string,
  ): unknown {
    if (typeof value === 'string')
      return value.startsWith(oldPrefix)
        ? newPrefix + value.slice(oldPrefix.length)
        : value;
    if (Array.isArray(value))
      return value.map((item: unknown) =>
        this.rewrite(item, oldPrefix, newPrefix),
      );
    // Preserve streams, dates, Prisma Decimal values, and other class instances.
    if (
      value &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype
    )
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          this.rewrite(item, oldPrefix, newPrefix),
        ]),
      );
    return value;
  }
}
