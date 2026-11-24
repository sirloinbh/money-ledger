export { newsQueue } from './jobs.js';
export { newsRouter } from './router.js';
export { type NewsSource, newsSourceFromEnv } from './source.js';
export type { NewsLog } from './store.js';

/** One JSON line per news event. Never holds keys or URLs. */
export const logNewsEvent = (event: Record<string, unknown>) => console.log(JSON.stringify(event));
