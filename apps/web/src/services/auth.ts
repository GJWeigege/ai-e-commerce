import { request } from './request';

export type AuthUser = {
  id: string;
  username: string;
  realName: string | null;
  tenantId: string | null;
  roles: string[];
  permissions: string[];
};

export function login(username: string, password: string) {
  return request<{ accessToken: string; user: AuthUser }>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function fetchProfile() {
  return request<AuthUser>('/api/v1/auth/profile');
}
