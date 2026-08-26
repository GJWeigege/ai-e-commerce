import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { CollectorType } from '@prisma/client';

export class CreateCsvTaskDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsEnum(CollectorType)
  collectorType?: CollectorType;
}
