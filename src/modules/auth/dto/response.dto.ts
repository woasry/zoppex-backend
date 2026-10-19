import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'alex@example.com' })
  email: string;

  @ApiProperty({ example: 'Alex' })
  firstName: string;

  @ApiPropertyOptional({ example: 'Morgan', nullable: true })
  lastName: string | null;

  @ApiPropertyOptional({ nullable: true })
  emailVerifiedAt: string | null;
}

export class OrganizationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Atelier Studio' })
  name: string;

  @ApiPropertyOptional({ example: 'London, United Kingdom', nullable: true })
  location: string | null;

  @ApiPropertyOptional({ nullable: true })
  contactEmail: string | null;

  @ApiProperty({ example: 'Europe/London' })
  timezone: string;
}

export class MembershipResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'MEMBER'] })
  role: string;

  @ApiProperty({ type: OrganizationResponseDto })
  organization: OrganizationResponseDto;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ type: [MembershipResponseDto] })
  memberships: MembershipResponseDto[];
}

export class MeResponseDto {
  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;

  @ApiProperty({ type: [MembershipResponseDto] })
  memberships: MembershipResponseDto[];
}

export class MessageResponseDto {
  @ApiProperty({ example: 'Operation completed' })
  message: string;
}
