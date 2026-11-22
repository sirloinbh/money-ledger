// What keeps the API up when the job runner fails (#178): background jobs start after the API listens (a failure
// is logged, not fatal), and a stop signal closes everything once. Lost DB connections are handled by createPool
// (standard/db.ts), which server.ts already uses.
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

type JobsState = 'off' | 'starting' | 'running' | 'failed';

const unavailable: Record<Exclude<JobsState, 'running'>, string> = {
  off: 'Background jobs are off on this server',
  starting: 'Background jobs are still starting',
  failed: 'Background jobs failed to start; see the server log',
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Holds the background jobs of this process. `start` runs `open(boss)` (startJobs) and then `afterStart`; a rejection
 * of either is logged and the API keeps serving. When `open` fails after pg-boss started (e.g. a queue policy
 * mismatch), the boss is stopped, so its own pool and timers do not outlive the failure. `status` answers
 * GET /api/jobs/status: the shared status view while the jobs run, otherwise a 503 that says why. `stop` waits for a
 * pending start, so a start that finishes after the stop signal does not leave pg-boss running.
 */
export function backgroundJobs(mode: JobsMode, log: JobLog = logJob) {
  let state: JobsState = mode === 'off' ? 'off' : 'starting';
  let jobs: Jobs | null = null;
  let starting: Promise<void> = Promise.resolve();

  const status: RequestHandler = (req, res, next) => {
    if (state !== 'running' || !jobs) {
      sendError(res, 503, unavailable[state === 'running' ? 'starting' : state]);
      return;
    }
    jobsStatus(jobs.boss)(req, res).catch(next);
  };

  function start<B extends Pick<JobBoss, 'stop'>>(
    boss: B,
    open: (boss: B) => Promise<Jobs>,
    afterStart: (jobs: Jobs) => Promise<unknown> = async () => {},
  ) {
    if (mode === 'off') return starting;
    starting = (async () => {
      try {
        jobs = await open(boss);
        state = 'running';
      } catch (error) {
        state = 'failed';
        log({ level: 'error', event: 'jobs_start_failed', message: messageOf(error) });
        try {
          await boss.stop({ graceful: false });
        } catch (stopError) {
          log({ level: 'error', event: 'jobs_stop_failed', message: messageOf(stopError) });
        }
        return;
      }
      try {
        await afterStart(jobs);
      } catch (error) {
        log({ level: 'error', event: 'jobs_after_start_failed', message: messageOf(error) });
      }
    })();
    return starting;
  }

  async function stop() {
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
