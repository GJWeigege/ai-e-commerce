import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { CollectorType } from '@prisma/client';
import { Type } from 'class-transformer';

export class HeartbeatDto {
  @IsString()
  agentKey: string;

  @IsEnum(CollectorType)
  type: CollectorType;

  @IsString()
  name: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  sessionValid?: boolean;

  @IsOptional()
  @IsString()
  version?: string;
}
