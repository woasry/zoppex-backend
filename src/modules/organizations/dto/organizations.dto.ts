import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MemberRole } from '@prisma/client';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({ example: 'Atelier Studio' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name: string;

  @ApiPropertyOptional({ example: 'London, United Kingdom' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location: string;

  @ApiPropertyOptional({ example: 'hello@atelier.example' })
  @IsOptional()
  @IsEmail()
  contactEmail: string;
}

export class CreateInvitationDto {
  @ApiProperty({ example: 'colleague@business.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: MemberRole, example: 'MEMBER' })
  @IsEnum(MemberRole)
  role: MemberRole;
}
