import { createHash, timingSafeEqual } from 'node:crypto';

import express, { type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { Pool } from 'pg';
import { z } from 'zod/v4';

import type { KisSource } from '../prices/kis.js';
import {
  type CommandSources,
  helpText,
  parseCommand,
  quickReplies,
  runCommand,
} from './commands.js';

// #312 POST /kakao/skill: the Kakao i Open Builder skill webhook. It is the only public endpoint of the app, so it
// answers nothing before two checks pass: the shared secret header, then the Kakao user ID allowlist. Both fail
// with the same generic 403, and a server without either setting refuses everything. Kakao drops a skill answer
// that takes longer than 5 seconds, so a command gets 4.

const SECRET_HEADER = 'x-kakao-skill-secret';
/** Kakao's limit is 5 s; leave a second for the network. */
const COMMAND_TIMEOUT_MS = 4000;
const refusal = { error: 'Not allowed' };

export type SkillConfig = { secret: string; allowedUserIds: string[] };

/** KAKAO_SKILL_SECRET (16+ characters) and KAKAO_ALLOWED_USER_IDS (comma-separated). Either missing: no config, so every request is refused. */
export function skillConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SkillConfig | undefined {
  const secret = env.KAKAO_SKILL_SECRET?.trim();
  const allowedUserIds = (env.KAKAO_ALLOWED_USER_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!secret || secret.length < 16 || allowedUserIds.length === 0) return undefined;
  return { secret, allowedUserIds };
}

const digest = (value: string) => createHash('sha256').update(value).digest();
/** Compares the SHA-256 of both, so the time taken does not depend on how many leading characters match. */
const sameText = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

// What Open Builder sends; only these fields are read and the rest is ignored.
const skillBody = z.object({
  userRequest: z.object({
    utterance: z.string().max(500),
    user: z.object({ id: z.string().min(1).max(256) }),
  }),
});

type SkillLog = (line: Record<string, unknown>) => void;
const logLine: SkillLog = (line) => console.log(JSON.stringify(line));

export type SkillOptions = {
  config: SkillConfig | undefined;
  sources?: CommandSources;
  /** For selling after a 매도 answer; the app passes its own. */
  kis?: KisSource;
  now?: () => Date;
  log?: SkillLog;
  timeoutMs?: number;
  /** Requests per client IP per minute, counted before the secret check. */
  requestsPerMinute?: number;
};

/** What kakao_commands stores: both strategy words are one command. */
const recorded = (name: string | undefined) =>
  name === 'day_trade' || name === 'long_hold'
    ? 'strategy'
    : name === 'keep' || name === 'sell'
      ? 'answer'
      : (name ?? 'unknown');

type Result = 'ok' | 'unavailable' | 'error' | 'timeout';

const answer = (text: string, extra: string[] = []) => ({
  version: '2.0',
  template: {
    outputs: [{ simpleText: { text } }],
    quickReplies: [...extra, ...quickReplies].map((label) => ({
      label,
      action: 'message',
      messageText: label,
    })),
  },
});

function timeout(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    timer.unref();
  });
}

/** The middleware chain to mount at /kakao/skill. It is not a Router, so the sign-in guarded API table does not list it. */
export function skillHandlers(
  pool: Pool,
  options: SkillOptions & { today: () => string },
): RequestHandler[] {
  const log = options.log ?? logLine;
  const sources = options.sources ?? {};
  const limit = options.timeoutMs ?? COMMAND_TIMEOUT_MS;

  // The reason goes to the log only; the caller always sees the same answer. No user ID is logged.
  const refuse = (res: express.Response, reason: string) => {
    log({ event: 'kakao_skill_refused', reason });
    res.status(403).json(refusal);
  };

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: options.requestsPerMinute ?? 60,
    standardHeaders: false,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests' });
    },
  });

  const checkSecret: RequestHandler = (req, res, next) => {
    const sent = req.get(SECRET_HEADER);
    if (req.method !== 'POST') return refuse(res, 'method');
    if (!options.config) return refuse(res, 'not-configured');
    if (typeof sent !== 'string' || !sameText(sent, options.config.secret))
      return refuse(res, 'secret');
    next();
  };

  const handle: RequestHandler = async (req, res, next) => {
    try {
      const parsed = skillBody.safeParse(req.body);
      if (!parsed.success) {
        log({ event: 'kakao_skill_refused', reason: 'body' });
        res.status(400).json({ error: 'Invalid request' });
        return;
      }
      const { utterance, user } = parsed.data.userRequest;
      if (!options.config?.allowedUserIds.some((id) => sameText(id, user.id)))
        return refuse(res, 'user');
      const name = parseCommand(utterance);
      let result: Result = 'ok';
      let text = helpText;
      let extra: string[] = [];
      if (name) {
        try {
          const outcome = await Promise.race([
            runCommand(name, {
              pool,
              today: options.today(),
              now: (options.now ?? (() => new Date()))(),
              kis: options.kis,
              sources,
            }),
            timeout(limit),
          ]);
          if (outcome === 'timeout') {
            result = 'timeout';
            text = 'That took too long. Try again in a moment.';
          } else {
            result = outcome.available ? 'ok' : 'unavailable';
            text = outcome.text;
            extra = outcome.extraReplies ?? [];
          }
        } catch (error) {
          result = 'error';
          text = 'Something went wrong. Try again in a moment.';
          log({ event: 'kakao_skill_error', command: name, message: String(error) });
        }
      } else {
        result = 'unavailable';
      }
      // The command and its result only: not the user ID, not what was typed.
      await pool
        .query('INSERT INTO kakao_commands (command, result) VALUES ($1, $2)', [
          recorded(name),
          result,
        ])
        .catch((error: unknown) =>
          log({ event: 'kakao_skill_record_failed', message: String(error) }),
        );
      log({ event: 'kakao_skill_command', command: recorded(name), result });
      res.json(answer(text, extra));
    } catch (error) {
      next(error);
    }
  };

  return [limiter, checkSecret, express.json({ limit: '16kb' }), handle];
}
