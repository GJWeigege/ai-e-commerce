import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertAgentCanWriteItem, redactCollectorConfig, sanitizeTaskForClient } from './crawler-security';

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
