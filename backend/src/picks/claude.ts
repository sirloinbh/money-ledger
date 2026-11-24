// The Claude Messages API client for the daily pick (#308), called with `fetch` (no SDK package: AGENTS.md).
// The key goes in a header and is never logged or put in an error message.

export type ClaudeRequest = { system: string; user: string; schema: Record<string, unknown> };
export type ClaudeAnswer = { text: string; model: string; raw: unknown };
export type ClaudeClient = { complete(request: ClaudeRequest): Promise<ClaudeAnswer> };

export class ClaudeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeError';
  }
}

const endpoint = 'https://api.anthropic.com/v1/messages';
/** Claude Opus 5.5, the skill's default; PICK_MODEL changes it without a code change. */
export const defaultModel = 'claude-opus-5-5';
const maxTokens = 8000;

type Block = { type?: unknown; text?: unknown };
type MessageBody = { content?: unknown; model?: unknown; stop_reason?: unknown };

/** Text of a Messages API answer, or a ClaudeError for a refusal, a cut-off answer or no text. */
export function answerOf(body: unknown): ClaudeAnswer {
  const message = (body ?? {}) as MessageBody;
  if (message.stop_reason === 'refusal') throw new ClaudeError('Claude declined the request');
  if (message.stop_reason === 'max_tokens')
    throw new ClaudeError('Claude ran out of output tokens');
  const blocks = Array.isArray(message.content) ? (message.content as Block[]) : [];
  const text = blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  if (!text) throw new ClaudeError('The Claude response had no text');
  return {
    text,
    model: typeof message.model === 'string' ? message.model : defaultModel,
    raw: body,
  };
}

export function anthropicClient(apiKey: string, model: string = defaultModel): ClaudeClient {
  return {
    async complete({ system, user, schema }) {
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            // A policy decline is re-run on the fallback model inside the same call.
            'anthropic-beta': 'server-side-fallback-2026-07-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            fallbacks: 'default',
            system,
            messages: [{ role: 'user', content: user }],
            output_config: { effort: 'high', format: { type: 'json_schema', schema } },
          }),
          signal: AbortSignal.timeout(300_000),
        });
      } catch {
        throw new ClaudeError('Could not connect to Claude');
      }
      if (!response.ok) throw new ClaudeError(`Claude response error (HTTP ${response.status})`);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ClaudeError('Could not read the Claude response');
      }
      return answerOf(body);
    },
  };
}

/** Deterministic stand-in for tests and for running without a key (PICK_SOURCE=fake): always picks `symbol`. */
export function fakeClaude(symbol = '005930', newsIds: number[] = []): ClaudeClient {
  return {
    complete() {
      const body = {
        newsIds,
        storyTitle: '가짜 뉴스 요약',
        storySummary: '테스트용 가짜 이야기입니다.',
        economicEffect: '테스트용 경제 영향입니다.',
        reasoning: '테스트용 근거입니다.',
        stockCode: symbol,
      };
      return Promise.resolve({ text: JSON.stringify(body), model: 'fake', raw: body });
    },
  };
}
