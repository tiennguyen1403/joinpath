import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import {
  createTemplateSchema,
  type Template,
  type TemplateIssue,
  type TemplateVersion,
} from '@joinpath/core';
import type { Request } from 'express';
import { Roles } from '../auth/session.js';
import { TemplatesService } from './templates.service.js';

// PLAN §8. Only HR may read or change templates (BR-T01, PLAN §9).
@Roles('HR')
@Controller()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('templates')
  list(@Req() req: Request): Promise<Template[]> {
    return this.templates.list(req.auth!);
  }

  @Post('templates')
  create(@Req() req: Request, @Body() body: unknown): Promise<Template> {
    return this.templates.create(req.auth!, createTemplateSchema.parse(body));
  }

  @Get('templates/:id')
  get(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Template> {
    return this.templates.get(req.auth!, id);
  }

  @Post('templates/:id/versions')
  createVersion(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateVersion> {
    return this.templates.createVersion(req.auth!, id);
  }

  @Post('templates/:id/archive')
  @HttpCode(200)
  archive(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Template> {
    return this.templates.archive(req.auth!, id);
  }

  @Get('template-versions/:id')
  getVersion(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateVersion> {
    return this.templates.getVersion(req.auth!, id);
  }

  // The body is the whole definition.
  @Put('template-versions/:id')
  saveDraft(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ): Promise<TemplateVersion & { issues: TemplateIssue[] }> {
    return this.templates.saveDraft(req.auth!, id, body);
  }

  // Discard draft: returns the template without it.
  @Delete('template-versions/:id')
  discardDraft(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Template> {
    return this.templates.discardDraft(req.auth!, id);
  }

  @Post('template-versions/:id/publish')
  @HttpCode(200)
  publish(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TemplateVersion> {
    return this.templates.publish(req.auth!, id);
  }
}
