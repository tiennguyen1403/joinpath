import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { HttpErrorFilter } from './http-error.filter.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { OrgModule } from './modules/org/org.module.js';
import { TemplatesModule } from './modules/templates/templates.module.js';
import { PrismaModule } from './prisma.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    OrgModule,
    TemplatesModule,
    OnboardingModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_FILTER, useClass: HttpErrorFilter }],
})
export class AppModule {}
