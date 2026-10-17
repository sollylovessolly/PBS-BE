import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MultipartExceptionFilter implements ExceptionFilter {
  catch(error: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    response
      .status(tooLarge ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST)
      .json({
        message: tooLarge
          ? 'Image exceeds the upload size limit'
          : 'Invalid multipart upload',
        code: error.code,
      });
  }
}
