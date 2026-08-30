import { BadRequestException, ForbiddenException } from '@nestjs/common';

const SECRET_CONFIG_KEYS = new Set(['cookie', 'cookies', 'proxy', 'proxies']);

export function redactCollectorConfig(config: unknown): unknown {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return config;
  }
  const copy: Record<string, unknown> = { ...(config as Record<string, unknown>) };
  for (const key of SECRET_CONFIG_KEYS) {
    delete copy[key];
  }
  return copy;
}

export function sanitizeTaskForClient<T extends { config?: unknown }>(task: T): T {
  return { ...task, config: redactCollectorConfig(task.config) };
}

export type ClaimedItemState = {
  status: string;
  assignedAgentId: string | null;
};

/** 插件只领取这些任务下的 PENDING 条目，已作废/结束的任务不再进轮询 */
export const CLAIMABLE_TASK_STATUSES = ['PENDING', 'QUEUED', 'RUNNING'] as const;

/** 作废时需要从领取队列拿掉的未完成条目 */
export const OPEN_ITEM_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'RETRYING'] as const;

const TERMINAL_TASK_STATUSES = ['SUCCESS', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED'] as const;

export function isClaimableTaskStatus(status: string): boolean {
  return (CLAIMABLE_TASK_STATUSES as readonly string[]).includes(status);
}

export function shouldPreserveTaskStatus(status: string): boolean {
  return status === 'CANCELLED' || status === 'PAUSED';
}

export function canCancelCrawlerTask(status: string): boolean {
  return isClaimableTaskStatus(status) || status === 'PAUSED';
}

export function canDeleteCrawlerTask(status: string): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

/** 任务回写必须由领取该条目的采集端完成，且条目仍处于 RUNNING */
export function assertAgentCanWriteItem(item: ClaimedItemState, agentId: string): void {
  if (item.status !== 'RUNNING') {
    throw new BadRequestException('当前条目不可回写（未领取或已结束）');
  }
  if (!item.assignedAgentId || item.assignedAgentId !== agentId) {
    throw new ForbiddenException('无权回写其他采集端领取的条目');
  }
}
