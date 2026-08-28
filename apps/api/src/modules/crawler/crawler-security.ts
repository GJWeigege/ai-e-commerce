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

/** 任务回写必须由领取该条目的采集端完成，且条目仍处于 RUNNING */
export function assertAgentCanWriteItem(item: ClaimedItemState, agentId: string): void {
  if (item.status !== 'RUNNING') {
    throw new BadRequestException('当前条目不可回写（未领取或已结束）');
  }
  if (!item.assignedAgentId || item.assignedAgentId !== agentId) {
    throw new ForbiddenException('无权回写其他采集端领取的条目');
  }
}
