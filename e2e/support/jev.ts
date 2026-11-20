// Managed file. Edit it in sirloinbh/project-standards templates/e2e/e2e/support/ (ADR-0028, #574).
// The core of the Jev judge for e2e tests, with no Playwright import: it builds the request, replays or records
// fixtures, and applies the gate. `judged.ts` wraps it for a Playwright page.
//
// Jev (TypeSafe AI) answers typed questions about text. With JEV_API_KEY and JEV_API_URL set, a call goes to the API
// and its answer is stored as e2e/fixtures/jev/<hash of the request>.json. Without them the stored answer with the
// same hash is replayed, so PR CI stays offline. No fixture and no key: the check is skipped, never failed.
// Only a confident wrong answer fails; anything else is a warning. The key stays in this Node process.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };
/** What a check expects, per question key: `noul` a boolean, `choice` an option key, `score` a level index. */
export type JevExpected = Record<string, boolean | string | number>;
export type JevRequest = { model: string; state: string; questions: Record<string, JevQuestion> };
type JevAnswer = {
  type?: string;
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
};
export type JevResponse = { answers: Record<string, JevAnswer>; usage?: { input_tokens?: number } };

/** A wrong answer with at least this confidence (for `noul`: probability) fails the test; below it only warns. */
export const CONFIDENCE_GATE = 0.9;
/** `state` plus one question must fit Jev's 32k token window: about 16k tokens for Korean. */
export const MAX_STATE_CHARS = 24_000;
/** Per run (one Node process): after these the helper skips instead of calling. */
export const MAX_CALLS = 50;
export const MAX_INPUT_TOKENS = 400_000;
const TIMEOUT_MS = 10_000;

export type JevEnv = { JEV_API_KEY?: string; JEV_API_URL?: string; JEV_MODEL?: string };
export type JevBudget = { calls: number; inputTokens: number };
export type JevOutcome =
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'invalid'; message: string }
  | { outcome: 'judged'; source: 'api' | 'fixture'; failures: string[]; warnings: string[] };

export const sharedBudget: JevBudget = { calls: 0, inputTokens: 0 };

export function buildRequest(
  state: string,
  questions: Record<string, JevQuestion>,
  model = 'typesafe/jev',
): JevRequest {
  return { model, state, questions };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The fixture name: a hash of the whole request, so a changed page or question needs a new recording. */
export function requestHash(request: JevRequest): string {
  return createHash('sha256').update(canonical(request)).digest('hex').slice(0, 32);
}

/** Compares one answer with its expectation. `wrong` is `confident` (fails) or `uncertain` (warns). */
export function gate(
  key: string,
  question: JevQuestion,
  answer: JevAnswer | undefined,
  expected: boolean | string | number,
): { ok: true } | { ok: false; confident: boolean; message: string } {
  if (!answer) return { ok: false, confident: false, message: `${key}: no answer` };
  if (question.type === 'noul') {
    const yes = answer.noul;
    if (typeof yes !== 'number')
      return { ok: false, confident: false, message: `${key}: no noul value` };
    const wrongSide = expected ? 1 - yes : yes;
    if (wrongSide < 0.5) return { ok: true };
    return {
      ok: false,
      confident: wrongSide >= CONFIDENCE_GATE,
      message: `${key}: expected ${String(expected)}, Jev says yes=${yes.toFixed(2)}`,
    };
  }
  const got = question.type === 'choice' ? answer.choice : Math.round(answer.score ?? Number.NaN);
  if (got === expected) return { ok: true };
  const confidence = answer.confidence ?? 0;
  return {
    ok: false,
    confident: confidence >= CONFIDENCE_GATE,
    message: `${key}: expected ${String(expected)}, Jev says ${String(got)} (confidence ${confidence.toFixed(2)})`,
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type JudgeOptions = {
  state: string;
  questions: Record<string, JevQuestion>;
  expected: JevExpected;
  fixtureDir: string;
  env?: JevEnv;
  fetchFn?: FetchLike;
  budget?: JevBudget;
};

async function callApi(
  request: JevRequest,
  url: string,
  key: string,
  fetchFn: FetchLike,
): Promise<JevResponse> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = (await response.json()) as JevResponse;
  if (!body || typeof body.answers !== 'object') throw new Error('no answers in the response');
  return body;
}

/** Asks Jev (or replays the recorded answer) and applies the gate. Never throws for an API problem. */
export async function judge(options: JudgeOptions): Promise<JevOutcome> {
  const env = options.env ?? {};
  const budget = options.budget ?? sharedBudget;
  if (options.state.length > MAX_STATE_CHARS) {
    return {
      outcome: 'invalid',
      message: `The text for Jev is ${options.state.length} characters; the limit is ${MAX_STATE_CHARS}. Judge a smaller region.`,
    };
  }
  const request = buildRequest(options.state, options.questions, env.JEV_MODEL || undefined);
  const file = join(options.fixtureDir, `${requestHash(request)}.json`);
  let response: JevResponse | undefined;
  let source: 'api' | 'fixture' = 'fixture';
  if (env.JEV_API_KEY && env.JEV_API_URL) {
    if (budget.calls >= MAX_CALLS || budget.inputTokens >= MAX_INPUT_TOKENS) {
      return {
        outcome: 'skipped',
        reason: 'jev-budget: the call or token cap of this run is used up',
      };
    }
    budget.calls += 1;
    try {
      response = await callApi(request, env.JEV_API_URL, env.JEV_API_KEY, options.fetchFn ?? fetch);
    } catch (err) {
      return {
        outcome: 'skipped',
        reason: `jev-error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    budget.inputTokens += response.usage?.input_tokens ?? Math.ceil(options.state.length / 1.5);
    source = 'api';
    await mkdir(options.fixtureDir, { recursive: true });
    await writeFile(file, `${JSON.stringify({ request, response }, null, 2)}\n`);
  } else {
    try {
      response = (JSON.parse(await readFile(file, 'utf8')) as { response: JevResponse }).response;
    } catch {
      return {
        outcome: 'skipped',
        reason: 'jev-fixture-missing: run once with JEV_API_KEY and JEV_API_URL to record it',
      };
    }
  }
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const [key, question] of Object.entries(options.questions)) {
    const expected = options.expected[key];
    if (expected === undefined) {
      failures.push(`${key}: no expected value`);
      continue;
    }
    const verdict = gate(key, question, response.answers[key], expected);
    if (!verdict.ok) (verdict.confident ? failures : warnings).push(verdict.message);
  }
  return { outcome: 'judged', source, failures, warnings };
}
