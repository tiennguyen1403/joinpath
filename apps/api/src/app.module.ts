import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { HttpErrorFilter } from './http-error.filter.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { PrismaModule } from './prisma.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: HttpErrorFilter }],
})
export class AppModule {}
