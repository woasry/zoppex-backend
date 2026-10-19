import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorEnvelope {
  statusCode: number;
  message: string | string[];
  error: string;
  timestamp: string;
  path: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorName = isHttpException
      ? exception.constructor.name.replace(/Exception$/, '')
      : 'Internal Server Error';

    let message: string | string[];
    if (isHttpException) {
      const responseBody = exception.getResponse();
      message =
        typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody
          ? ((responseBody as { message: string | string[] }).message as string | string[])
          : exception.message;
    } else {
      message = 'An unexpected error occurred';
    }
    if (typeof message === 'string' && message.startsWith('ThrottlerException: ')) {
      message = message.slice('ThrottlerException: '.length);
    }

    if (statusCode >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `${request.method} ${request.url} → ${statusCode}`,
        stack,
      );
    }

    const envelope: ErrorEnvelope = {
      statusCode,
      message,
      error: errorName,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(envelope);
  }
}
