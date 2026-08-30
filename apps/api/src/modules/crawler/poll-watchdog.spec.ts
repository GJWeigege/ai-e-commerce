import { POLL_STUCK_MS, shouldForceUnlockPoll, withTimeout } from '@aiecom/collector-core';

describe('withTimeout', () => {
  it('resolves when the work finishes before the budget', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 50, 'timeout')).resolves.toBe('ok');
  });

  it('rejects when the work hangs past the budget', async () => {
    const hung = new Promise<string>(() => undefined);
    await expect(withTimeout(hung, 20, '采集超时')).rejects.toThrow('采集超时');
  });
});

describe('shouldForceUnlockPoll', () => {
  it('keeps a fresh in-flight poll locked', () => {
    expect(shouldForceUnlockPoll({ busy: true, startedAt: 1_000, now: 1_500, stuckMs: 3_000 })).toBe(false);
  });

  it('unlocks a poll that has been busy longer than the watchdog', () => {
    expect(shouldForceUnlockPoll({ busy: true, startedAt: 1_000, now: 5_000, stuckMs: 3_000 })).toBe(true);
  });

  it('does not unlock an idle poller', () => {
    expect(shouldForceUnlockPoll({ busy: false, startedAt: 1_000, now: 9_000, stuckMs: 3_000 })).toBe(false);
  });

  it('uses the same 3-minute budget as the Chrome poller watchdog', () => {
    expect(POLL_STUCK_MS).toBe(180_000);
    expect(
      shouldForceUnlockPoll({ busy: true, startedAt: 0, now: POLL_STUCK_MS, stuckMs: POLL_STUCK_MS }),
    ).toBe(false);
    expect(
      shouldForceUnlockPoll({ busy: true, startedAt: 1, now: 1 + POLL_STUCK_MS, stuckMs: POLL_STUCK_MS }),
    ).toBe(true);
  });
});
