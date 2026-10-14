import {
  Global,
  Injectable,
  Module,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { PrismaClient } from './generated/prisma/client.js';

// Modules call Prisma directly; there is no repository layer (PLAN §6.3).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  }

  // Closes the pg pool, so app.close() in tests leaves no connection open.
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
