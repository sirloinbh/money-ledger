import { anthropicClient, type ClaudeClient, defaultModel, fakeClaude } from './claude.js';

export { pickBuyDeps } from './buy.js';
export { pickQueue } from './jobs.js';
export { picksRouter } from './router.js';
export type { PickDeps } from './run.js';

/** One JSON line per pick event. Never holds the key or the model's full answer. */
export const logPickEvent = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

const key = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/**
 * The Claude client from the environment: PICK_SOURCE=fake uses the fake (refused in production); otherwise the
 * real client when ANTHROPIC_API_KEY is set (model: PICK_MODEL, default claude-opus-5-5), else none.
 */
export function claudeFromEnv(env: NodeJS.ProcessEnv = process.env): ClaudeClient | undefined {
  if (env.PICK_SOURCE?.trim() === 'fake') {
    if (env.NODE_ENV === 'production')
      throw new Error('PICK_SOURCE=fake cannot be used in production');
    return fakeClaude();
  }
  const apiKey = key(env.ANTHROPIC_API_KEY);
  return apiKey ? anthropicClient(apiKey, key(env.PICK_MODEL) ?? defaultModel) : undefined;
}
