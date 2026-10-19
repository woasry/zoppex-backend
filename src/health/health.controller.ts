import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

export interface HealthResponse {
  status: string;
  timestamp: string;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOkResponse({ description: 'Service is healthy', type: Object })
  check(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
