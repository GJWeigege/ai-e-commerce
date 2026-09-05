import { Agent, CursorAgentError } from '@cursor/sdk';
import { OpenAiCompatibleProvider } from '@aiecom/llm-core';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';

const STORAGE_HELP =
  'Cursor 账号关闭了 Storage（Privacy Mode），Agent API 无法保存会话。请打开 Cursor Settings（Ctrl+Shift+J）→ General，关闭 Privacy Mode 或开启 Storage；也可到 https://cursor.com/dashboard 的 Privacy 里确认。保存后无需重登，再点一次预估即可。';

function errorMessage(error: unknown): string {
  if (error instanceof CursorAgentError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isStorageDisabled(error: unknown): boolean {
  const text = errorMessage(error);
  const code = error instanceof CursorAgentError ? error.code : undefined;
  return (
    code === 'feature_unavailable' ||
    /storage mode is disabled|feature_unavailable|enable storage/i.test(text)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class CursorAgentClient {
  private readonly logger = new Logger(CursorAgentClient.name);

  async completeText(prompt: string): Promise<{ text: string; model: string; runId: string }> {
    const apiKey = process.env.CURSOR_API_KEY?.trim();
    if (!apiKey) {
      throw new BadRequestException('未配置 CURSOR_API_KEY，无法调用 Cursor Agent 预估包裹');
    }
    const model = process.env.CURSOR_MODEL?.trim() || 'composer-2.5';
    const runtime = (process.env.CURSOR_AGENT_RUNTIME || 'local').trim().toLowerCase();
    const order = runtime === 'local' ? (['local', 'cloud'] as const) : (['cloud', 'local'] as const);

    let lastError: unknown;
    for (const current of order) {
      try {
        return await this.runAgent(prompt, apiKey, model, current);
      } catch (error) {
        lastError = error;
        if (isStorageDisabled(error) && current !== order[order.length - 1]) {
          this.logger.warn(`Cursor ${current} 因 Storage 关闭失败，改走 ${order[1]}`);
          continue;
        }
        if (isStorageDisabled(error)) {
          const fallback = await this.completeViaLlm(prompt);
          if (fallback) {
            this.logger.warn('Cursor Agent Storage 不可用，已回退到 LLM_API_KEY');
            return fallback;
          }
          throw new BadRequestException(STORAGE_HELP);
        }
        if (error instanceof CursorAgentError && error.isRetryable) {
          await sleep(1500);
          try {
            return await this.runAgent(prompt, apiKey, model, current);
          } catch (retryError) {
            lastError = retryError;
          }
        }
        if (error instanceof CursorAgentError) {
          throw new BadRequestException(`Cursor Agent 启动失败: ${error.message}`);
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new BadRequestException('Cursor Agent 调用失败');
  }

  private async runAgent(
    prompt: string,
    apiKey: string,
    model: string,
    runtime: 'cloud' | 'local',
  ): Promise<{ text: string; model: string; runId: string }> {
    const useFast = process.env.CURSOR_MODEL_FAST !== 'false';
    const modelSel = useFast ? { id: model, params: [{ id: 'fast', value: 'true' }] } : { id: model };
    const options =
      runtime === 'local'
        ? {
            apiKey,
            model: modelSel,
            local: { cwd: process.cwd() },
            tools: [] as string[],
          }
        : {
            apiKey,
            model: modelSel,
            cloud: { repos: [] as Array<{ url: string }> },
          };
    const result = await Agent.prompt(prompt, options);
    if (result.status === 'error') {
      throw new BadRequestException(`Cursor Agent 运行失败: ${result.error?.message || result.id}`);
    }
    const text = String(result.result || '').trim();
    if (!text) {
      throw new BadRequestException('Cursor Agent 未返回预估结果');
    }
    const modelLabel = useFast ? `${model}-fast` : model;
    this.logger.log(`package-estimate run=${result.id} model=${modelLabel} runtime=${runtime}`);
    return { text, model: modelLabel, runId: result.id };
  }

  /** Privacy Mode 挡住 Agent API 时，用已有 LLM 选品通道补预估，避免业务卡死 */
  private async completeViaLlm(prompt: string): Promise<{ text: string; model: string; runId: string } | null> {
    const apiKey = process.env.LLM_API_KEY?.trim();
    if (!apiKey) {
      return null;
    }
    const model = process.env.LLM_MODEL?.trim() || 'gpt-4o-mini';
    const provider = new OpenAiCompatibleProvider({
      apiKey,
      baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model,
      providerName: process.env.LLM_PROVIDER || 'openai-compatible',
    });
    const raw = await provider.completeJson(prompt);
    return { text: JSON.stringify(raw), model, runId: 'llm-fallback' };
  }
}
