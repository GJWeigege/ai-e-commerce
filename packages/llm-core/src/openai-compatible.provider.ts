import { ILlmProvider } from './llm.interface';

export class OpenAiCompatibleProvider implements ILlmProvider {
  readonly provider: string;
  readonly model: string;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      model: string;
      providerName?: string;
    },
  ) {
    this.provider = options.providerName ?? 'openai-compatible';
    this.model = options.model;
  }

  async completeJson(prompt: string): Promise<unknown> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: '只输出 JSON 对象。' },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`LLM 请求失败: ${response.status}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('LLM 返回空内容');
    }
    return JSON.parse(content);
  }
}
