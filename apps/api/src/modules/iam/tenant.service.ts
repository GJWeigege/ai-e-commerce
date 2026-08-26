import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantStatus } from '@prisma/client';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    return this.prisma.tenant.create({
      data: {
        name: dto.name,
        code: dto.code.trim().toUpperCase(),
        remark: dto.remark,
        isolationMode: 'SHARED',
      },
    });
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.ensureExists(id);
    return this.prisma.tenant.update({
      where: { id },
      data: {
        name: dto.name,
        remark: dto.remark,
      },
    });
  }

  async changeStatus(id: string, status: TenantStatus) {
    await this.ensureExists(id);
    if (status === 'CLOSED') {
      throw new ForbiddenException('租户关闭请走停用流程');
    }
    return this.prisma.tenant.update({
      where: { id },
      data: { status },
    });
  }

  async findById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) {
      throw new NotFoundException('租户不存在');
    }
    return tenant;
  }

  async page(query: PageQueryDto & { keyword?: string; status?: TenantStatus }): Promise<PageResult<unknown>> {
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' as const } },
              { code: { contains: query.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  private async ensureExists(id: string) {
    const exists = await this.prisma.tenant.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('租户不存在');
    }
  }
}
