import { IsEnum, IsOptional, IsString } from 'class-validator';
import { CrawlerItemStatus, CrawlerTaskStatus } from '@prisma/client';
import { PageQueryDto } from '../../../common/dto/page-query.dto';

export class CrawlerTaskQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(CrawlerTaskStatus)
  status?: CrawlerTaskStatus;

  @IsOptional()
  @IsString()
  keyword?: string;
}

export class CrawlerItemQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(CrawlerItemStatus)
  status?: CrawlerItemStatus;
}
