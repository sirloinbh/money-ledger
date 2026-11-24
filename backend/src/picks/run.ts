import type { Pool } from 'pg';

import { serviceDate } from '../standard/http.js';
import type { ClaudeClient } from './claude.js';
import { answerSchema, buildPrompt, parseAnswer, systemPrompt } from './prompt.js';
import { activeKoreanSecurity, newsForPick, pickOfDay, savePick, setPickOrder } from './store.js';

// #308 One run of the daily pick: read the headlines, ask Claude, check its answer, store the pick, then buy.

type PickLog = (event: Record<string, unknown>) => void;

/** What the run needs from outside: the model client and the all-in buy (#307). */
export type PickDeps = {
  claude: ClaudeClient;
  /** True when a v2 position is already open: the run is skipped. */
  hasOpenPosition: () => Promise<boolean>;
  /** Places the all-in buy for the pick and returns the order id. It must be safe to call again for one pick. */
  buy: (pick: { pickId: number; securityId: number; day: string }) => Promise<number>;
  log: PickLog;
};

export type PickResult =
  | { status: 'skipped_open_position' }
  | { status: 'no_news' }
  | { status: 'no_valid_pick'; problem: string }
  | { status: 'picked'; pickId: number; orderId: number | null; buyError: string | null }
  | { status: 'already_picked'; pickId: number; orderId: number | null; buyError: string | null };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function buyFor(pool: Pool, deps: PickDeps, pickId: number, securityId: number, day: string) {
  try {
    const orderId = await deps.buy({ pickId, securityId, day });
    await setPickOrder(pool, pickId, orderId);
    return { orderId, buyError: null };
  } catch (error) {
    deps.log({ event: 'pick_buy_failed', pickId, message: messageOf(error) });
    return { orderId: null, buyError: messageOf(error) };
  }
}

/**
 * Runs the pick for the service date of `now`. Claude's answer must name headlines that exist and an active
 * Korean security; otherwise it is asked once more with the reason. A pick that is stored but not bought (the buy
 * failed) is bought on the next run, so a retry never makes a second pick.
 */
export async function runDailyPick(pool: Pool, deps: PickDeps, now: Date): Promise<PickResult> {
  const day = serviceDate(now);
  const existing = await pickOfDay(pool, day);
  if (existing) {
    if (existing.order_id !== null) {
      return {
        status: 'already_picked',
        pickId: existing.id,
        orderId: existing.order_id,
        buyError: null,
      };
    }
    if (await deps.hasOpenPosition()) return { status: 'skipped_open_position' };
    const bought = await buyFor(pool, deps, existing.id, existing.security_id, day);
    return { status: 'already_picked', pickId: existing.id, ...bought };
  }
  if (await deps.hasOpenPosition()) return { status: 'skipped_open_position' };
  const news = await newsForPick(pool, day);
  if (news.length === 0) return { status: 'no_news' };
  const known = new Set(news.map((item) => item.id));

  let problem = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const answer = await deps.claude.complete({
      system: systemPrompt,
      user: buildPrompt(news, attempt === 1 ? undefined : problem),
      schema: answerSchema,
    });
    const parsed = parseAnswer(answer.text);
    if ('problem' in parsed) {
      problem = parsed.problem;
    } else {
      const ids = parsed.answer.newsIds.filter((id) => known.has(id));
      const security = await activeKoreanSecurity(pool, parsed.answer.stockCode);
      if (ids.length === 0) problem = 'newsIds must name ids from the given headlines';
      else if (!security) problem = `${parsed.answer.stockCode} is not an active Korean stock code`;
      else {
        const pickId = await savePick(pool, {
          day,
          newsItemIds: [...new Set(ids)],
          storyTitle: parsed.answer.storyTitle,
          storySummary: parsed.answer.storySummary,
          economicEffect: parsed.answer.economicEffect,
          reasoning: parsed.answer.reasoning,
          securityId: security.id,
          model: answer.model,
          raw: answer.raw,
        });
        if (pickId === null) {
          // Another run stored the day's pick between the check above and now.
          const stored = await pickOfDay(pool, day);
          return {
            status: 'already_picked',
            pickId: stored?.id ?? 0,
            orderId: stored?.order_id ?? null,
            buyError: null,
          };
        }
        deps.log({ event: 'pick_saved', day, pickId, symbol: security.symbol, attempt });
        const bought = await buyFor(pool, deps, pickId, security.id, day);
        return { status: 'picked', pickId, ...bought };
      }
    }
    deps.log({ event: 'pick_rejected', day, attempt, problem });
  }
  return { status: 'no_valid_pick', problem };
}
