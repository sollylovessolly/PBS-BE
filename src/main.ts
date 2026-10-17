import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { SafeExceptionFilter } from './security/safe-exception.filter';
import { LegacyArtworkInterceptor } from './uploads/legacy-artwork.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  // Vercel supplies client IPs through its trusted edge proxy.
  if (process.env.VERCEL) app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      hsts:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true }
          : false,
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const configService = app.get(ConfigService);
  app.useGlobalInterceptors(new LegacyArtworkInterceptor(configService));
  app.useGlobalFilters(new SafeExceptionFilter());
  const bodyLimit = configService.get<string>('JSON_BODY_LIMIT', '1mb');
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { limit: bodyLimit, extended: true });

  const port = configService.get<number>('PORT', 4000);

  const allowedOrigins = [
    configService.get<string>('FRONTEND_URL', 'http://localhost:3000'),
    configService.get<string>('ADMIN_FRONTEND_URL', 'http://localhost:3001'),
    configService.get<string>('ADDITIONAL_FRONTEND_ORIGINS', ''),
  ].flatMap((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  app.setGlobalPrefix('api');

  const swaggerConfig = new DocumentBuilder()
    .setTitle('PolaroidsBySolly API')
    .setDescription(
      'API documentation for PolaroidsBySolly products, orders, inventory and business management',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, swaggerDocument);

  app.enableCors({
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });

  await app.listen(port);

  console.log(`PolaroidsBySolly API running on http://localhost:${port}`);
  console.log(`Swagger documentation: http://localhost:${port}/api/docs`);
}

void bootstrap();
