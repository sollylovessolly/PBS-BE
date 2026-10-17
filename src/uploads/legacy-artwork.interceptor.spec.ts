import { ConfigService } from '@nestjs/config';
import type { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { LegacyArtworkInterceptor } from './legacy-artwork.interceptor';

describe('LegacyArtworkInterceptor', () => {
  it('moves only legacy artwork links and preserves other values and private-file tokens', async () => {
    const interceptor = new LegacyArtworkInterceptor({
      get: (key: string, fallback?: string) =>
        key === 'PUBLIC_API_URL' ? 'https://new.example' : fallback,
    } as ConfigService);
    const date = new Date();
    const result = await firstValueFrom(
      interceptor.intercept({} as ExecutionContext, {
        handle: () =>
          of({
            date,
            items: [
              {
                customization: {
                  finalPngUrl:
                    'https://polaroidsbysolly-be.onrender.com/api/uploads/files/unchanged-token',
                  other: 'https://external.example/file.png',
                },
              },
            ],
          }),
      }),
    );
    expect(result).toEqual({
      date,
      items: [
        {
          customization: {
            finalPngUrl:
              'https://new.example/api/uploads/files/unchanged-token',
            other: 'https://external.example/file.png',
          },
        },
      ],
    });
  });
});
