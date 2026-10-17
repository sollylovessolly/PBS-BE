import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Serverless instances share Neon's pooled URL. Local/Render deployments
    // retain their direct connection; migrations always use DIRECT_URL.
    const connectionString = process.env.VERCEL
      ? process.env.DATABASE_URL
      : (process.env.DIRECT_URL ?? process.env.DATABASE_URL);

    if (!connectionString) {
      throw new Error(
        'Neither DIRECT_URL nor DATABASE_URL is set in the environment',
      );
    }

    const adapter = new PrismaPg({
      connectionString,
      max: process.env.VERCEL ? 2 : 10,
      connectionTimeoutMillis: 20_000,
      idleTimeoutMillis: 30_000,
    });

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
