import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  assertAgentCanWriteItem,
  canCancelCrawlerTask,
  canDeleteCrawlerTask,
  CLAIMABLE_TASK_STATUSES,
  isClaimableTaskStatus,
  OPEN_ITEM_STATUSES,
  redactCollectorConfig,
  sanitizeTaskForClient,
  shouldPreserveTaskStatus,
} from './crawler-security';

describe('crawler security helpers', () => {
  it('strips cookies and proxies from task config', () => {
    expect(
      redactCollectorConfig({
        cookie: 'sid=secret',
        proxies: ['http://user:pass@proxy:8080'],
        crawlAllSkus: true,
      }),
    ).toEqual({ crawlAllSkus: true });
    expect(sanitizeTaskForClient({ id: '1', config: { cookie: 'x' } })).toEqual({ id: '1', config: {} });
  });

  it('rejects replay and foreign agents', () => {
    expect(() => assertAgentCanWriteItem({ status: 'SUCCESS', assignedAgentId: 'a1' }, 'a1')).toThrow(
      BadRequestException,
    );
    expect(() => assertAgentCanWriteItem({ status: 'RUNNING', assignedAgentId: 'a1' }, 'a2')).toThrow(
      ForbiddenException,
    );
    expect(() => assertAgentCanWriteItem({ status: 'RUNNING', assignedAgentId: 'a1' }, 'a1')).not.toThrow();
  });
});

describe('crawler task cancel / claim filter', () => {
  it('lets the plugin claim only unfinished live tasks', () => {
    expect(CLAIMABLE_TASK_STATUSES).toEqual(['PENDING', 'QUEUED', 'RUNNING']);
    expect(isClaimableTaskStatus('RUNNING')).toBe(true);
    expect(isClaimableTaskStatus('CANCELLED')).toBe(false);
    expect(isClaimableTaskStatus('FAILED')).toBe(false);
    expect(isClaimableTaskStatus('SUCCESS')).toBe(false);
  });

  it('allows voiding a stuck running task but not a second cancel', () => {
    expect(canCancelCrawlerTask('RUNNING')).toBe(true);
    expect(canCancelCrawlerTask('QUEUED')).toBe(true);
    expect(canCancelCrawlerTask('PAUSED')).toBe(true);
    expect(canCancelCrawlerTask('CANCELLED')).toBe(false);
    expect(canCancelCrawlerTask('SUCCESS')).toBe(false);
  });

  it('keeps cancelled status from being overwritten by item refresh', () => {
    expect(shouldPreserveTaskStatus('CANCELLED')).toBe(true);
    expect(shouldPreserveTaskStatus('PAUSED')).toBe(true);
    expect(shouldPreserveTaskStatus('RUNNING')).toBe(false);
  });

  it('only deletes already stopped tasks so running work is voided first', () => {
    expect(canDeleteCrawlerTask('CANCELLED')).toBe(true);
    expect(canDeleteCrawlerTask('FAILED')).toBe(true);
    expect(canDeleteCrawlerTask('RUNNING')).toBe(false);
  });

  it('treats pending/running/retrying items as open work to skip on cancel', () => {
    expect(OPEN_ITEM_STATUSES).toEqual(['PENDING', 'QUEUED', 'RUNNING', 'RETRYING']);
  });
});
