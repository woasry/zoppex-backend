import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  token: string;
}
