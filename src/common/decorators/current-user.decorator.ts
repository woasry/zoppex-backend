import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../interfaces/request-context.interface';

export const CurrentUser = createParamDecorator(
  (data: unknown, context: ExecutionContext): JwtPayload | undefined => {
    const request = context.switchToHttp().getRequest();
    return request.user;
  },
);
