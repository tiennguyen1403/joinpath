import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';
import { TaskController } from './task.controller.js';
import { TaskService } from './task.service.js';

@Module({
  controllers: [OnboardingController, TaskController],
  providers: [OnboardingService, TaskService],
})
export class OnboardingModule {}
