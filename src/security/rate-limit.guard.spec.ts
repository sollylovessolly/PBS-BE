import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('RateLimitGuard', () => {
  it('uses atomic database counters across serverless instances', async () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = '1';
    try {
      const prisma = {
        $queryRaw: jest
          .fn()
          .mockResolvedValueOnce([{ count: 1, retryAfter: 60 }])
          .mockResolvedValueOnce([{ count: 2, retryAfter: 59 }]),
      };
      const response = { setHeader: jest.fn() };
      const context = {
        getHandler: () => function login() {},
        getClass: () => class AuthController {},
        switchToHttp: () => ({
          getRequest: () => ({ ip: '1.2.3.4', socket: {} }),
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext;
      const reflector = {
        getAllAndOverride: () => ({ env: 'LIMIT', fallback: 1 }),
      };
      const guard = new RateLimitGuard(
        reflector as unknown as Reflector,
        { get: () => 1 } as unknown as ConfigService,
        prisma as unknown as PrismaService,
      );
      await expect(guard.canActivate(context)).resolves.toBe(true);
      await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 59);
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
  it('throttles a decorated endpoint after its configured per-minute limit', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue({ env: 'LIMIT', fallback: 5 }),
    };
    const config = { get: jest.fn().mockReturnValue('2') };
    const request = { ip: '127.0.0.1', socket: {} };
    const context = {
      getHandler: () => function login() {},
      getClass: () => class AuthController {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new RateLimitGuard(
      reflector as unknown as Reflector,
      config as unknown as ConfigService,
    );
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });
});
