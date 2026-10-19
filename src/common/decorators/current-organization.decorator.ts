import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrganizationContext } from '../interfaces/request-context.interface';

export const CurrentOrganization = createParamDecorator(
  (data: unknown, context: ExecutionContext): OrganizationContext | undefined => {
    const request = context.switchToHttp().getRequest();
    return request.organizationContext;
  },
);
