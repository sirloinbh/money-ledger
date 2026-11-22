// What keeps the API up when the job runner fails (#178): background jobs start after the API listens (a failure
// is logged, not fatal, and retried, #235), and a stop signal closes everything once. Lost DB connections are
// handled by createPool (standard/db.ts), which server.ts already uses.
import type { RequestHandler } from 'express';

import { sendError } from './standard/http.js';
import {
  type JobBoss,
  type JobLog,
  type Jobs,
  type JobsMode,
  jobsStatus,
  logJob,
} from './standard/jobs.js';

type JobsState = 'off' | 'starting' | 'retrying' | 'running' | 'failed';

const unavailable: Record<Exclude<JobsState, 'running'>, string> = {
  off: 'Background jobs are off on this server',
  starting: 'Background jobs are still starting',
  retrying: 'Background jobs failed to start and will try again; see the server log',
  failed: 'Background jobs failed to start; see the server log',
};

/**
 * Seconds to wait before each new start attempt after a failure (#235): 7 attempts over about 9 minutes, enough for a
 * database that is restarting or not up yet. After the last one the jobs stay off until the API restarts.
 */
const START_RETRY_DELAYS_MS = [5, 15, 30, 60, 120, 300].map((seconds) => seconds * 1000);

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Resolves after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

/**
 * Holds the background jobs of this process. `start` makes a boss with `createBoss` and runs `open(boss)` (startJobs
 * with every queue), then `afterStart`; a rejection is logged and the API keeps serving. A failed start stops that
 * boss, so its own pool and timers do not outlive the failure, and tries again with a new boss after each of
 * `retryDelaysMs` (#235). It retries the whole start, so it covers every registered queue. `status` answers
 * GET /api/jobs/status: the shared status view while the jobs run, otherwise a 503 that says why. `stop` cancels a
 * waiting retry and waits for a running attempt, so a start that finishes after the stop signal does not leave
 * pg-boss running.
 */
export function backgroundJobs(
  mode: JobsMode,
  log: JobLog = logJob,
  retryDelaysMs: readonly number[] = START_RETRY_DELAYS_MS,
) {
  let state: JobsState = mode === 'off' ? 'off' : 'starting';
  let jobs: Jobs | null = null;
  let starting: Promise<void> = Promise.resolve();
  const stopping = new AbortController();

  const status: RequestHandler = (req, res, next) => {
    if (state !== 'running' || !jobs) {
      sendError(res, 503, unavailable[state === 'running' ? 'starting' : state]);
      return;
    }
    jobsStatus(jobs.boss)(req, res).catch(next);
  };

  async function attempt<B extends Pick<JobBoss, 'stop'>>(
    createBoss: () => B,
    open: (boss: B) => Promise<Jobs>,
    number: number,
  ) {
    const boss = createBoss();
    try {
      jobs = await open(boss);
      return true;
    } catch (error) {
      const delay = retryDelaysMs[number - 1];
      const retry = delay !== undefined && !stopping.signal.aborted;
      log({
        level: 'error',
        event: 'jobs_start_failed',
        attempt: number,
        ...(retry ? { retryInSeconds: delay / 1000 } : { final: true }),
        message: messageOf(error),
      });
      try {
        await boss.stop({ graceful: false });
      } catch (stopError) {
        log({ level: 'error', event: 'jobs_stop_failed', message: messageOf(stopError) });
      }
      return false;
    }
  }

  function start<B extends Pick<JobBoss, 'stop'>>(
    createBoss: () => B,
    open: (boss: B) => Promise<Jobs>,
    afterStart: (jobs: Jobs) => Promise<unknown> = async () => {},
  ) {
    if (mode === 'off') return starting;
    starting = (async () => {
      for (let number = 1; ; number += 1) {
        if (await attempt(createBoss, open, number)) break;
        const delay = retryDelaysMs[number - 1];
        if (delay === undefined || stopping.signal.aborted) {
          state = 'failed';
          return;
        }
        state = 'retrying';
        await pause(delay, stopping.signal);
        if (stopping.signal.aborted) {
          state = 'failed';
          return;
        }
      }
      state = 'running';
      try {
        await afterStart(jobs!);
      } catch (error) {
        log({ level: 'error', event: 'jobs_after_start_failed', message: messageOf(error) });
      }
    })();
    return starting;
  }

  async function stop() {
    stopping.abort();
    await starting;
    if (!jobs) return;
    try {
      await jobs.stop();
    } catch (error) {
      log({ level: 'error', event: 'jobs_stop_failed', message: messageOf(error) });
    }
  }

  return { status, start, stop, state: () => state };
}

type Closable = { close(callback: () => void): unknown };

/**
 * A SIGTERM/SIGINT handler: stops taking requests, stops the jobs, then ends the pool. A second signal while
 * shutting down does nothing, and a failing step is logged so the next one still runs.
 */
export function shutdownOnce(
  server: Closable,
  runtime: { stop(): Promise<void> },
  pool: { end(): Promise<void> },
  log: JobLog = logJob,
) {
  let closing: Promise<void> | null = null;
  return () => {
    closing ??= new Promise<void>((resolve) => {
      server.close(() => {
        void runtime
          .stop()
          .then(() => pool.end())
          .catch((error: unknown) =>
            log({ level: 'error', event: 'shutdown_failed', message: messageOf(error) }),
          )
          .finally(resolve);
      });
    });
    return closing;
  };
}
