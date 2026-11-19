// Managed file. Edit it in sirloinbh/project-standards templates/jobs/backend/src/standard/
// Shared background jobs on pg-boss in the app's own Postgres (ADR-0018, #556). The app creates the PgBoss instance
// (`new PgBoss(jobBossOptions(url))`) and passes it in; this file imports only types, so the central repo tests it
// with a fake and it does not pin a pg-boss version. Docs: docs/jobs.md in project-standards.
//
//   const jobs = await startJobs(new PgBoss(jobBossOptions(process.env.DATABASE_URL!)), [priceQueue], {
//     mode: jobsModeFromEnv(),
//   });
//   app.get('/api/jobs/status', jobsStatus(jobs.boss));  // under /api, so app.use('/api', auth) guards it
//   await jobs.send('send-receipt', { entryId: 42 }, { key: 'entry-42', requestId: requestIdOf(res) });
//   process.on('SIGTERM', () => server.close(() => void jobs.stop().then(() => pool.end())));
import type { Request, Response } from 'express';

// The same value as serviceTimeZone in http.ts, repeated so this file imports only types.
export const JOB_TIME_ZONE = 'Asia/Seoul';
/** pg-boss keeps its own pool; a small one leaves the app's `pg` pool its connections (ADR-0018). */
export const JOB_POOL_MAX = 2;
export const JOB_SCHEMA = 'pgboss';
/** One dead-letter queue per app: a job that runs out of retries, or fails with NonRetryable, is copied here. */
export const DEAD_LETTER_QUEUE = 'dead-letter';
/** Payloads hold IDs and small inputs only; anything larger is refused when sent. */
export const MAX_PAYLOAD_BYTES = 4096;
/** Error messages are cut to this length before they reach the job row, the log, and the status view. */
export const MAX_ERROR_LENGTH = 200;
const RETRY_DEFAULTS = { retryLimit: 3, retryDelay: 30, retryBackoff: true };
// Long enough for a slow outside call, short enough that a deploy does not hang (docker stop waits 10s by default).
const STOP_TIMEOUT_MS = 8000;

/**
 * Throw it from a handler when retrying cannot help (bad input, a 4xx from another service): the job goes to the
 * dead-letter queue at once instead of using up its retries. An error with a 4xx `status` (HttpError) or a zod
 * error counts too.
 */
export class NonRetryable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryable';
  }
}

/**
 * pg-boss queue policies, by what a `key` (singletonKey) guarantees (pg-boss 12 unique indexes):
 * - `standard`: nothing; `send` with a `key` is refused on it.
 * - `short`: one queued job per key; a job may still be running.
 * - `singleton`: one running job per key; more may be queued.
 * - `stately`: one queued, one retrying and one running job per key.
 * - `exclusive`: one queued or running job per key. "One per thing" (a double click queues one job).
 */
export type JobPolicy = 'standard' | 'short' | 'singleton' | 'stately' | 'exclusive';

/** What a handler learns about its job besides the input. `attempt` starts at 1. */
export type JobInfo = { id: string; queue: string; attempt: number; requestId: string | null };

export type JobQueue<T extends object = object> = {
  name: string;
  /** Must be safe to run twice: write with an upsert or check "done" first (ADR-0018). */
  // Method syntax, so a JobQueue<{ entryId: number }> fits the JobQueue[] that startJobs takes.
  handler(input: T, job: JobInfo): Promise<unknown>;
  /** Default `standard`. Fixed once the queue exists: a different policy needs a new queue name. */
  policy?: JobPolicy;
  /** Retries after the first attempt. Default 3. */
  retryLimit?: number;
  /** Seconds before the first retry, doubled each time with jitter. Default 30. */
  retryDelay?: number;
  /** Seconds a run may take before pg-boss fails it (and retries it). pg-boss default: 900. */
  expireInSeconds?: number;
  /** Cron in Asia/Seoul, e.g. `0 12-18 * * *`; the job input is `scheduleInput` (default `{}`). */
  schedule?: string;
  scheduleInput?: T;
};

/** `all`: send and work the queues in this process (the default, ADR-0018). `send`: send only, a `worker`
 * service works them. `off`: do not start pg-boss at all (tests, a second local server on the same DB). */
export type JobsMode = 'all' | 'send' | 'off';

type StoredJob = { input: object; requestId: string | null };
type BossJob = { id: string; name: string; data: unknown; retryCount: number };
type BossResult = { id: string; status: 'completed' | 'failed' | 'deadletter'; output?: object };
type QueueRow = {
  name: string;
  policy?: string;
  queuedCount: number;
  activeCount: number;
  failedCount: number;
  deferredCount: number;
  totalCount: number;
};
type JobRow = {
  id: string;
  state: string;
  retryCount: number;
  createdOn: Date;
  completedOn: Date | null;
  output: unknown;
  data: unknown;
  // Set on a dead-letter copy: the failed job's queue, output and retries (pg-boss keeps its own output empty).
  sourceName?: string | null;
  sourceOutput?: unknown;
  sourceRetryCount?: number | null;
};

/** The part of pg-boss 12 this file uses. A real `PgBoss` instance fits it. */
export type JobBoss = {
  start(): Promise<unknown>;
  stop(options?: { graceful?: boolean; timeout?: number }): Promise<void>;
  getQueue(name: string): Promise<{ name: string; policy?: string } | null>;
  createQueue(name: string, options?: object): Promise<void>;
  updateQueue(name: string, options?: object): Promise<void>;
  work(name: string, options: object, handler: (jobs: BossJob[]) => Promise<BossResult[]>): Promise<string>;
  send(name: string, data: object, options?: object): Promise<string | null>;
  schedule(name: string, cron: string, data?: object, options?: object): Promise<void>;
  unschedule(name: string): Promise<void>;
  getSchedules(): Promise<{ name: string; cron: string; timezone: string; lastJobId: string | null }[]>;
  getQueues(): Promise<QueueRow[]>;
  findJobs(name: string, options?: { limit?: number; after?: string }): Promise<JobRow[]>;
  on?(event: 'error', listener: (error: Error) => void): unknown;
};

export type JobLog = (line: Record<string, unknown>) => void;

/** One JSON line per job run, like requestLog in http.ts. Never the payload: it may hold IDs a log should not. */
export const logJob: JobLog = (line) => {
  const text = JSON.stringify({ time: new Date().toISOString(), ...line });
  if (line.level === 'error') console.error(text);
  else console.log(text);
};

/** Constructor options for `new PgBoss(...)`: the app's own Postgres, schema `pgboss`, a pool of 2. */
export function jobBossOptions(connectionString: string) {
  return { connectionString, schema: JOB_SCHEMA, max: JOB_POOL_MAX, application_name: 'jobs' };
}

/** JOBS_MODE from the environment; anything else than `send` or `off` is `all`. */
export function jobsModeFromEnv(env: Record<string, string | undefined> = process.env): JobsMode {
  return env.JOBS_MODE === 'send' || env.JOBS_MODE === 'off' ? env.JOBS_MODE : 'all';
}

function queueOptions(queue: JobQueue) {
  return {
    retryLimit: queue.retryLimit ?? RETRY_DEFAULTS.retryLimit,
    retryDelay: queue.retryDelay ?? RETRY_DEFAULTS.retryDelay,
    retryBackoff: RETRY_DEFAULTS.retryBackoff,
    deadLetter: DEAD_LETTER_QUEUE,
    ...(queue.expireInSeconds ? { expireInSeconds: queue.expireInSeconds } : {}),
  };
}

// Matched by shape, like errorHandler in http.ts, so HttpError and zod errors count without importing them.
function isNonRetryable(error: unknown) {
  if (error instanceof NonRetryable) return true;
  if (typeof error !== 'object' || error === null) return false;
  const { status, name } = error as { status?: unknown; name?: unknown };
  // 408 (timeout), 425 (too early) and 429 (rate limited) say "try again later", so they are retried with backoff.
  const retryable4xx = status === 408 || status === 425 || status === 429;
  return (typeof status === 'number' && status >= 400 && status < 500 && !retryable4xx) || name === 'ZodError';
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

function stored(data: unknown): StoredJob {
  const value = (typeof data === 'object' && data !== null ? data : {}) as Partial<StoredJob>;
  const input = typeof value.input === 'object' && value.input !== null ? value.input : {};
  return { input, requestId: typeof value.requestId === 'string' ? value.requestId : null };
}

/** The pg-boss handler for one queue (exported for the central test): one result per job, so a NonRetryable
 * error dead-letters only its own job and other errors are retried with backoff. */
export function wrapHandler(queue: JobQueue, log: JobLog) {
  const retryLimit = queueOptions(queue).retryLimit;
  // A broken log must not fail the job: pg-boss would then retry work that already succeeded.
  const safeLog: JobLog = (line) => {
    try {
      log(line);
    } catch {
      // ignored
    }
  };
  return async (jobs: BossJob[]): Promise<BossResult[]> => {
    const results: BossResult[] = [];
    for (const job of jobs) {
      const { input, requestId } = stored(job.data);
      const attempt = job.retryCount + 1;
      const base = { queue: queue.name, jobId: job.id, attempt, requestId };
      const started = performance.now();
      try {
        await queue.handler(input, { id: job.id, queue: queue.name, attempt, requestId });
        safeLog({ level: 'info', ...base, result: 'ok', ms: Math.round(performance.now() - started) });
        results.push({ id: job.id, status: 'completed' });
      } catch (error) {
        const message = errorMessage(error);
        const final = isNonRetryable(error);
        const result = final ? 'dead-letter' : job.retryCount < retryLimit ? 'retry' : 'failed';
        const level = result === 'retry' ? 'warn' : 'error';
        safeLog({ level, ...base, result, ms: Math.round(performance.now() - started), message });
        results.push({ id: job.id, status: final ? 'deadletter' : 'failed', output: { message } });
      }
    }
    return results;
  };
}

/** Creates or updates one queue; pg-boss's createQueue ignores an existing queue, so its options are updated. */
async function ensureQueue(boss: JobBoss, name: string, options: object & { policy?: string }) {
  const existing = await boss.getQueue(name);
  if (existing) {
    // pg-boss cannot change a queue's policy (UpdateQueueOptions leaves it out), so a queue created with another
    // policy would silently lose the guarantee the code relies on (e.g. singleton). Stop at start instead.
    const { policy, ...rest } = options;
    if (policy && existing.policy && existing.policy !== policy) {
      throw new Error(
        `Queue "${name}" already exists with policy "${existing.policy}", but the code asks for "${policy}". ` +
          'A policy cannot be changed: give the queue a new name (or drop the old queue by hand).',
      );
    }
    // pg-boss rejects an update with no properties ("no properties found to update"), e.g. for the dead-letter queue.
    if (Object.keys(rest).length > 0) await boss.updateQueue(name, rest);
  } else {
    await boss.createQueue(name, options);
  }
}

export type Jobs = {
  boss: JobBoss;
  /** Queues a job. `key` is pg-boss's singletonKey: what it prevents depends on the queue policy (JobPolicy), and
   * a send the policy refuses returns null. A `key` on a `standard` queue throws, because it would not dedupe. */
  send(name: string, input: object, options?: { key?: string; requestId?: string; startAfter?: Date | number }): Promise<string | null>;
  /** Waits for running jobs (up to 8 s), then closes pg-boss's own pool. Call it before the app's pool ends. */
  stop(): Promise<void>;
};

/**
 * Starts pg-boss, creates the dead-letter queue and every queue, sets their schedules, and works them unless
 * `send`. In `all` mode this process owns every queue, so a schedule whose queue is gone from `queues` is removed.
 */
export async function startJobs(
  boss: JobBoss,
  queues: JobQueue[],
  options: { mode?: JobsMode; log?: JobLog } = {},
): Promise<Jobs> {
  const mode = options.mode ?? 'all';
  const log = options.log ?? logJob;
  const policies = new Map(queues.map((q) => [q.name, q.policy ?? 'standard']));
  if (policies.size !== queues.length || policies.has(DEAD_LETTER_QUEUE)) {
    throw new Error(`Queue names must be unique and not "${DEAD_LETTER_QUEUE}"`);
  }
  const send: Jobs['send'] = async (name, input, sendOptions = {}) => {
    const policy = policies.get(name);
    if (!policy) throw new Error(`Unknown queue "${name}"`);
    if (sendOptions.key && policy === 'standard') {
      throw new Error(`Queue "${name}" is standard, so a key would not dedupe; give it the exclusive or short policy`);
    }
    const data: StoredJob = { input, requestId: sendOptions.requestId ?? null };
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_PAYLOAD_BYTES) {
      throw new Error(`Job payload for "${name}" is over ${MAX_PAYLOAD_BYTES} bytes; send IDs, not data`);
    }
    if (mode === 'off') return null;
    return boss.send(name, data, {
      ...(sendOptions.key ? { singletonKey: sendOptions.key } : {}),
      ...(sendOptions.startAfter !== undefined ? { startAfter: sendOptions.startAfter } : {}),
    });
  };
  if (mode === 'off') return { boss, send, stop: () => Promise.resolve() };

  boss.on?.('error', (error) => log({ level: 'error', event: 'jobs_error', message: errorMessage(error) }));
  await boss.start();
  await ensureQueue(boss, DEAD_LETTER_QUEUE, {});
  for (const queue of queues) {
    await ensureQueue(boss, queue.name, { policy: queue.policy ?? 'standard', ...queueOptions(queue) });
  }
  for (const queue of queues) {
    if (queue.schedule) {
      const data: StoredJob = { input: queue.scheduleInput ?? {}, requestId: null };
      await boss.schedule(queue.name, queue.schedule, data, { tz: JOB_TIME_ZONE });
    }
  }
  if (mode === 'all') {
    const wanted = new Set(queues.filter((q) => q.schedule).map((q) => q.name));
    for (const { name } of await boss.getSchedules()) {
      if (!wanted.has(name)) await boss.unschedule(name); // removed from the code
    }
    for (const queue of queues) {
      await boss.work(queue.name, { batchSize: 1, perJobResults: true }, wrapHandler(queue, log));
    }
  }
  return { boss, send, stop: () => boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS }) };
}

const RECENT_PER_QUEUE = 10;
const DEAD_LETTER_SHOWN = 50;
const PAGE = 1000;
// Volume is small (ADR-0018: a few hundred runs a day, 7 days kept), so paging stops long before this.
const MAX_PAGES = 20;

/** The newest `count` jobs of a queue, newest first. pg-boss's findJobs lists oldest first, so it pages to the end. */
async function newestJobs(boss: JobBoss, name: string, count: number) {
  let tail: JobRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await boss.findJobs(name, after ? { limit: PAGE, after } : { limit: PAGE });
    tail = [...tail, ...rows].slice(-count);
    if (rows.length < PAGE) break;
    after = rows[rows.length - 1].id;
  }
  return tail.reverse();
}

function summary(job: JobRow) {
  const output = (job.sourceOutput ?? job.output) as { message?: unknown } | null;
  return {
    id: job.id,
    state: job.state,
    attempt: (job.sourceRetryCount ?? job.retryCount) + 1,
    createdOn: job.createdOn,
    completedOn: job.completedOn,
    requestId: stored(job.data).requestId,
    ...(typeof output?.message === 'string' ? { error: output.message } : {}),
    ...(job.sourceName ? { from: job.sourceName } : {}),
  };
}

/** The status view (ADR-0018): counts per queue, recent and failed jobs, dead-lettered jobs, and schedules. */
export async function jobsStatusData(boss: JobBoss) {
  // pg-boss 12 keeps internal queues (e.g. __pgboss__send-it) beside the app's own.
  const queues = (await boss.getQueues()).filter((q) => !q.name.startsWith('__pgboss__'));
  const recent: Record<string, ReturnType<typeof summary>[]> = {};
  for (const queue of queues) {
    if (queue.name === DEAD_LETTER_QUEUE) continue;
    recent[queue.name] = (await newestJobs(boss, queue.name, RECENT_PER_QUEUE)).map(summary);
  }
  const deadLetter = queues.some((q) => q.name === DEAD_LETTER_QUEUE)
    ? (await newestJobs(boss, DEAD_LETTER_QUEUE, DEAD_LETTER_SHOWN)).map(summary)
    : [];
  const schedules = (await boss.getSchedules()).map(({ name, cron, timezone, lastJobId }) => ({
    name,
    cron,
    timezone,
    lastJobId,
  }));
  return {
    queues: queues.map((q) => ({
      name: q.name,
      policy: q.policy ?? 'standard',
      queued: q.queuedCount,
      deferred: q.deferredCount,
      active: q.activeCount,
      failed: q.failedCount,
      total: q.totalCount,
    })),
    recent,
    failed: Object.values(recent)
      .flat()
      .filter((job) => job.state === 'failed'),
    deadLetter,
    schedules,
  };
}

/** Read-only JSON handler for the status view. Mount it under /api so the app's shared sign-in guards it. */
export function jobsStatus(boss: JobBoss) {
  return async (_req: Request, res: Response) => {
    res.json(await jobsStatusData(boss));
  };
}
