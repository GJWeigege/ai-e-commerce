import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ListingLockStore } from './wb-listing-concurrency';

const RELEASE_LOCK = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

@Injectable()
export class RedisListingLockStore implements ListingLockStore, OnModuleDestroy {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.get<string>('REDIS_URL', 'redis://localhost:6380'));
  }

  async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(key, owner, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return true;
    }
    // 同一 job 重试时锁可能仍在，续期后继续跑，避免空等 TTL
    const current = await this.redis.get(key);
    if (current !== owner) {
      return false;
    }
    await this.redis.pexpire(key, ttlMs);
    return true;
  }

  async release(key: string, owner: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK, 1, key, owner);
  }

  async onModuleDestroy() {
    this.redis.disconnect();
  }
}
