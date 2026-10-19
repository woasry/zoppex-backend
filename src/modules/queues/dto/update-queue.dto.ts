import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateQueueDto {
  @ApiProperty({ example: 'Walk-in assistance' })
  @IsString()
  @MaxLength(60)
  service: string;

  @ApiProperty({ example: 5 })
  @IsInt()
  @Min(1)
  @Max(120)
  avgMinutes: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(50)
  desks: number;
}
