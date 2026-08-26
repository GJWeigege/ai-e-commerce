import { RoleCode } from '@prisma/client';

export type AuthUser = {
  id: string;
  username: string;
  realName: string | null;
  tenantId: string | null;
  roles: RoleCode[];
  permissions: string[];
};

export type JwtPayload = {
  sub: string;
  username: string;
  tenantId: string | null;
};
