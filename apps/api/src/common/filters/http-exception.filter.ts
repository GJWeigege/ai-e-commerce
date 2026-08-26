import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import {
  AccountUnboundException,
  CrossTenantException,
  TenantRequiredException,
} from '../tenant/tenant-scope';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof CrossTenantException || exception instanceof AccountUnboundException) {
      status = HttpStatus.FORBIDDEN;
      message = exception.message;
    } else if (exception instanceof TenantRequiredException) {
      status = HttpStatus.BAD_REQUEST;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      message = typeof payload === 'string' ? payload : this.extractMessage(payload);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = '数据已存在，请检查唯一字段';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = '记录不存在';
      }
    } else if (exception instanceof ForbiddenException) {
      status = HttpStatus.FORBIDDEN;
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(exception);
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
    });
  }

  private extractMessage(payload: unknown): string {
    if (typeof payload === 'object' && payload && 'message' in payload) {
      const message = (payload as { message: string | string[] }).message;
      return Array.isArray(message) ? message.join('; ') : message;
    }
    return '请求失败';
  }
}
