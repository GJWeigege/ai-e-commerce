import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { CurrentTenantId, CurrentUser } from '../../common/decorators/current.decorators';
import { AuthUser } from '../auth/auth.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserPageQueryDto } from './dto/user-page-query.dto';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermissions('user:list')
  page(
    @CurrentUser() actor: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Query() query: UserPageQueryDto,
  ) {
    return this.userService.page(actor, tenantId, query);
  }

  @Post()
  @RequirePermissions('user:create')
  create(
    @CurrentUser() actor: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Body() dto: CreateUserDto,
  ) {
    return this.userService.create(actor, tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('user:update')
  update(
    @CurrentUser() actor: AuthUser,
    @CurrentTenantId() tenantId: string | null,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.userService.update(actor, tenantId, id, dto);
  }
}
