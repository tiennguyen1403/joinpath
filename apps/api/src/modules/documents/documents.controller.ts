import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type DownloadUrl,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  type OnboardingDetail,
} from '@joinpath/core';
import type { Request } from 'express';
import { HttpErrorFilter } from '../../http-error.filter.js';
import { DocumentsService, type Upload } from './documents.service.js';

// Multer refuses a file over the limit with 413. BR-P04 answers 400, as for any file refused
// (AT-29).
@Catch(PayloadTooLargeException)
class FileTooLargeFilter implements ExceptionFilter {
  catch(_: PayloadTooLargeException, host: ArgumentsHost) {
    new HttpErrorFilter().catch(
      new BadRequestException(`A file can be ${MAX_FILE_MB} MB at most`),
      host,
    );
  }
}

// PLAN §8. Anyone works on the documents assigned to them (PLAN §9), so no route names a role.
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('tasks/:id/files')
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(
    // One file a request, as Vercel caps a request body at 4.5 MB (ADR 011). Browsers send
    // file names in UTF-8.
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_BYTES, files: 1 },
      defParamCharset: 'utf8',
    }),
  )
  upload(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Upload | undefined,
  ): Promise<OnboardingDetail> {
    return this.documents.upload(req.auth!, id, file);
  }

  @Delete('tasks/:id/files/:fileId')
  remove(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ): Promise<OnboardingDetail> {
    return this.documents.remove(req.auth!, id, fileId);
  }

  @Post('tasks/:id/submit')
  @HttpCode(200)
  submit(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OnboardingDetail> {
    return this.documents.submit(req.auth!, id);
  }

  @Get('files/:id/download-url')
  downloadUrl(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DownloadUrl> {
    return this.documents.downloadUrl(req.auth!, id);
  }
}
