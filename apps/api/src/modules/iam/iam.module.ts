import { Module } from '@nestjs/common';
import { ShopAccessService } from '../../common/shop/shop-access.service';
import { RoleController } from './role.controller';
import { ShopController } from './shop.controller';
import { ShopService } from './shop.service';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [TenantController, UserController, RoleController, ShopController],
  providers: [TenantService, UserService, ShopService, ShopAccessService],
  exports: [ShopAccessService],
})
export class IamModule {}
