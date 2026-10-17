import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  canActivate(context: ExecutionContext) {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const limit = this.positiveInt(
      this.config.get(options.env),
      options.fallback,
    );
    const now = Date.now();
    const ip = request.ip || request.socket.remoteAddress || 'unknown';
    const key = `${context.getClass().name}:${context.getHandler().name}:${ip}`;
    if (process.env.VERCEL && this.prisma) {
      return this.durableLimit(key, limit, context);
    }
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + 60_000 });
      this.prune(now);
      return true;
    }
    if (bucket.count >= limit) {
      const http = context.switchToHttp() as unknown as {
        getResponse?: () => Response;
      };
      http
        .getResponse?.()
        .setHeader(
          'Retry-After',
          Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        );
      throw new HttpException(
        'Too many requests. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    bucket.count += 1;
    return true;
  }

  private async durableLimit(
    key: string,
    limit: number,
    context: ExecutionContext,
  ) {
    const digest = createHash('sha256').update(key).digest('hex');
    const rows = await this.prisma!.$queryRaw<
      Array<{ count: number; retryAfter: number }>
    >`
      INSERT INTO "ApiRateLimit" ("key", "count", "resetAt")
      VALUES (${digest}, 1, NOW() + INTERVAL '1 minute')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "ApiRateLimit"."resetAt" <= NOW() THEN 1 ELSE "ApiRateLimit"."count" + 1 END,
        "resetAt" = CASE WHEN "ApiRateLimit"."resetAt" <= NOW() THEN NOW() + INTERVAL '1 minute' ELSE "ApiRateLimit"."resetAt" END
      RETURNING "count", GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("resetAt" - NOW()))))::int AS "retryAfter"
    `;
    if (rows[0].count > limit) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', rows[0].retryAfter);
      throw new HttpException(
        'Too many requests. Please try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private positiveInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private prune(now: number) {
    if (this.buckets.size < 1_000) return;
    for (const [key, value] of this.buckets)
      if (value.resetAt <= now) this.buckets.delete(key);
  }
}
