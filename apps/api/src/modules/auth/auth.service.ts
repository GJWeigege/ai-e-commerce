import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { ROLE_CODES, resolveEffectivePermissions, type RoleCode } from '@aiecom/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { AuthUser, JwtPayload } from './auth.types';

const AUTH_USER_INCLUDE = {
  tenant: { select: { status: true } },
  userRoles: {
    include: {
      role: true,
    },
  },
  moduleAccesses: {
    include: { permission: true },
  },
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: AUTH_USER_INCLUDE,
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.tenantId && user.tenant?.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户名或密码错误');
    }

    const matched = await compare(dto.password, user.passwordHash);
    if (!matched) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const authUser = this.toAuthUser(user);
    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      tenantId: user.tenantId,
    };
    const accessToken = await this.jwt.signAsync(payload);

    return { accessToken, user: authUser };
  }

  async findAuthUser(userId: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: AUTH_USER_INCLUDE,
    });
    if (!user || user.status !== 'ACTIVE') {
      return null;
    }
    if (user.tenantId && user.tenant?.status !== 'ACTIVE') {
      return null;
    }
    return this.toAuthUser(user);
  }

  private toAuthUser(user: {
    id: string;
    username: string;
    realName: string | null;
    tenantId: string | null;
    userRoles: Array<{ role: { code: string } }>;
    moduleAccesses: Array<{ permission: { code: string } }>;
  }): AuthUser {
    const roles = user.userRoles
      .map((item) => item.role.code)
      .filter((code): code is RoleCode => (ROLE_CODES as readonly string[]).includes(code));
    const assignedModules = user.moduleAccesses.map((item) => item.permission.code);
    return {
      id: user.id,
      username: user.username,
      realName: user.realName,
      tenantId: user.tenantId,
      roles,
      permissions: resolveEffectivePermissions(roles, assignedModules),
    };
  }
}
