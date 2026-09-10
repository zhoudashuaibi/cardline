import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * 统一错误响应体：
 * { statusCode, code, message, details }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = '服务器内部错误';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        message = payload;
      } else if (payload && typeof payload === 'object') {
        const body = payload as Record<string, unknown>;
        const rawMessage = body.message;
        if (Array.isArray(rawMessage)) {
          message = rawMessage.join('; ');
          details = rawMessage;
        } else if (typeof rawMessage === 'string') {
          message = rawMessage;
        }
        if (typeof body.code === 'string') code = body.code;
        if (body.details !== undefined) details = body.details;
      }
      if (code === 'INTERNAL') code = defaultCodeForStatus(status);
    } else if (exception instanceof Error) {
      message = exception.message || message;
      this.logger.error(exception.stack || exception.message);
    }

    if (status >= 500) {
      this.logger.error(`${status} ${code} ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      code,
      message,
      ...(details === undefined ? {} : { details }),
    });
  }
}

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_INPUT';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'UNAUTHORIZED';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    default:
      return status >= 500 ? 'INTERNAL' : 'BAD_INPUT';
  }
}
