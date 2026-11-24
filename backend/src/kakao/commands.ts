import type { Pool } from 'pg';

import { accountReturn, benchmarkReturns } from '../benchmark.js';
import { accountValue } from '../mock/holdings.js';
import { chooseStrategy } from '../mock/positions.js';
import { pickOfDay } from '../picks/store.js';
import { HttpError } from '../standard/http.js';
import type { Template } from './api.js';
import {
  accountSummaryMessage,
  formatPct,
  formatWon,
  type NewsReason,
  type PositionLine,
  positionsMessage,
} from './messages.js';

// #312 The chatbot commands. Each one returns the text to show; the skill endpoint (skill.ts) wraps it for Kakao.
// The reply text comes from the #311 message builders, so the chatbot and the messages the app sends on its own
// read the same.

export type CommandName = 'status' | 'positions' | 'news' | 'returns' | 'day_trade' | 'long_hold';

/** The words a user can type or tap, in Korean and English. Anything else is an unknown command. */
const aliases: Record<string, CommandName> = {
  상태: 'status',
  status: 'status',
  포지션: 'positions',
  positions: 'positions',
  뉴스: 'news',
  news: 'news',
  수익률: 'returns',
  returns: 'returns',
  단타: 'day_trade',
  'day trade': 'day_trade',
  장투: 'long_hold',
  'long hold': 'long_hold',
};

export function parseCommand(utterance: string): CommandName | undefined {
  return aliases[utterance.trim().toLowerCase()];
}

/** The quick-reply buttons under every answer: the label and the text sent back when tapped. */
export const quickReplies = ['상태', '포지션', '뉴스', '수익률'] as const;

/** Return of the account next to each benchmark over the same days; a benchmark that is not known is null. */
type ReturnComparison = {
  startDate: string;
  endDate: string;
  accountPct: string;
  depositPct: string | null;
  buffettPct: string | null;
  renaissancePct: string | null;
};

/**
 * Where 뉴스 and 수익률 read from. The server uses the database (`databaseSources`); a test can replace either one.
 */
export type CommandSources = {
  news?: () => Promise<NewsReason | undefined>;
  returns?: () => Promise<ReturnComparison | undefined>;
};

/** Today's pick (#308) and the account return with its benchmarks (#294), read when the command runs. */
function databaseSources(pool: Pool, today: string): Required<CommandSources> {
  return {
    async news() {
      const pick = await pickOfDay(pool, today);
      if (!pick) return undefined;
      return {
        headline: pick.story_title,
        effect: pick.economic_effect,
        stockName: pick.name ?? pick.symbol,
        symbol: pick.symbol,
        reason: pick.reasoning,
      };
    },
    async returns() {
      const id = await openAccountId(pool);
      if (id === undefined) return undefined;
      const account = await accountReturn(pool, id, today);
      // No day after the start yet: there is no period to compare.
      if (account.returnPct === null || account.startDate === null || account.endDate === null)
        return undefined;
      const benchmarks = await benchmarkReturns(pool, account.startDate, account.endDate);
      const pct = (name: string) => benchmarks.find((item) => item.id === name)?.returnPct ?? null;
      return {
        startDate: account.startDate,
        endDate: account.endDate,
        accountPct: account.returnPct,
        depositPct: pct('deposit'),
        buffettPct: pct('buffett'),
        renaissancePct: pct('renaissance'),
      };
    },
  };
}

export type CommandReply = {
  text: string;
  /** Buttons to show besides the usual ones, e.g. the strategy choice while a position waits for it. */
  extraReplies?: string[];
  /** false when the command had nothing to show (no account, no source yet). */
  available: boolean;
};

const link = '/';
const reply = (text: string): CommandReply => ({ text, available: true });
const unavailable = (text: string): CommandReply => ({ text, available: false });

/** The text of a #311 template. Its Kakao link button does not apply inside a chatbot reply. */
const textOf = (template: Template) => String(template.text ?? '');

async function openAccountId(pool: Pool) {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM mock_accounts WHERE closed_at IS NULL',
  );
  return rows[0]?.id;
}

async function openAccountValue(pool: Pool, today: string) {
  const id = await openAccountId(pool);
  return id === undefined ? undefined : accountValue(pool, id, today);
}

const noAccount = () =>
  unavailable('There is no mock trading account yet. Open one in the app first.');

async function status(pool: Pool, today: string): Promise<CommandReply> {
  const value = await openAccountValue(pool, today);
  if (!value) return noAccount();
  const { summary } = value;
  if (summary.totalKrw === null || summary.profitKrw === null || summary.returnPct === null) {
    // A holding without a stored price makes the totals unknown rather than wrong (holdings.ts).
    return reply(
      [
        'Mock account summary',
        `Capital: ${formatWon(summary.initialCashKrw)}`,
        `Cash: ${formatWon(summary.cashKrw)}`,
        'Total value and return are unknown until every held stock has a stored price.',
      ].join('\n'),
    );
  }
  return reply(
    textOf(
      accountSummaryMessage(
        {
          capitalKrw: summary.initialCashKrw,
          cashKrw: summary.cashKrw,
          totalValueKrw: summary.totalKrw,
          profitKrw: summary.profitKrw,
          returnPct: summary.returnPct,
        },
        link,
      ),
    ),
  );
}

const strategyOf = { day_trade: 'day', long_hold: 'long', undecided: null } as const;

async function positions(pool: Pool, today: string): Promise<CommandReply> {
  const id = await openAccountId(pool);
  const value = id === undefined ? undefined : await accountValue(pool, id, today);
  if (id === undefined || !value) return noAccount();
  // The strategy of each held security's open position (#307): one position per all-in buy.
  const strategies = await pool.query<{
    security_id: number;
    strategy: keyof typeof strategyOf;
  }>(
    `SELECT DISTINCT ON (security_id) security_id, strategy FROM mock_positions
     WHERE account_id = $1 AND closed_at IS NULL ORDER BY security_id, opened_at DESC, id DESC`,
    [id],
  );
  const byStock = new Map(strategies.rows.map((row) => [row.security_id, row.strategy]));
  const lines: PositionLine[] = value.holdings.map((holding) => ({
    name: holding.security.name ?? holding.security.symbol,
    symbol: holding.security.symbol,
    quantity: holding.quantity,
    strategy:
      strategyOf[
        (holding.security.id === null ? undefined : byStock.get(holding.security.id)) ?? 'undecided'
      ],
    returnPct: holding.returnPct ?? '0.00',
  }));
  const waiting = [...byStock.values()].includes('undecided');
  return {
    ...reply(textOf(positionsMessage(lines, link))),
    ...(waiting && { extraReplies: [...strategyReplies] }),
  };
}

const strategyReplies = ['단타', '장투'] as const;
const strategyName = { day_trade: 'Day trade', long_hold: 'Long hold' } as const;
const strategyRule = {
  day_trade: 'It sells by itself at +5% or -3% of the buy price.',
  long_hold: 'It is kept; I ask again each morning whether to keep or sell.',
} as const;

/** Chooses the strategy of every open position that is still undecided. With all-in buys that is usually one. */
async function choose(pool: Pool, strategy: 'day_trade' | 'long_hold'): Promise<CommandReply> {
  const id = await openAccountId(pool);
  if (id === undefined) return noAccount();
  const { rows } = await pool.query<{ id: number; symbol: string; name: string | null }>(
    `SELECT p.id, s.symbol, s.name FROM mock_positions p JOIN securities s ON s.id = p.security_id
     WHERE p.account_id = $1 AND p.closed_at IS NULL AND p.strategy = 'undecided' ORDER BY p.id`,
    [id],
  );
  if (rows.length === 0)
    return unavailable('No position is waiting for a day trade or long hold choice.');
  const chosen: string[] = [];
  for (const row of rows) {
    try {
      await chooseStrategy(pool, row.id, strategy, 'kakao');
      chosen.push(`${row.name ?? row.symbol} (${row.symbol})`);
    } catch (error) {
      // Sold or chosen elsewhere between the list and the update: skip it, the rest still apply.
      if (!(error instanceof HttpError && error.status === 409)) throw error;
    }
  }
  if (chosen.length === 0)
    return unavailable('That position was already sold or its strategy was already chosen.');
  return reply(`${strategyName[strategy]}: ${chosen.join(', ')}\n${strategyRule[strategy]}`);
}

/** Kakao shows up to 1,000 characters in one text bubble. */
const bubbleLimit = 1000;

async function news(sources: Required<CommandSources>): Promise<CommandReply> {
  const pick = await sources.news();
  if (!pick) return unavailable('There is no news pick for today yet.');
  // The shared builder cuts at 200 characters (a send-to-me limit); the chatbot has room for the whole reason.
  const body = [
    `News: ${pick.headline}`,
    `Effect: ${pick.effect}`,
    `Pick: ${pick.stockName} (${pick.symbol})`,
    `Why: ${pick.reason}`,
  ].join('\n');
  return reply(body.length > bubbleLimit ? `${body.slice(0, bubbleLimit - 1)}…` : body);
}

const pctOrNa = (pct: string | null) => (pct === null ? 'n/a' : formatPct(pct));

async function returns(sources: Required<CommandSources>): Promise<CommandReply> {
  const comparison = await sources.returns();
  if (!comparison)
    return unavailable('There is no return to compare yet: it needs a day after the start.');
  return reply(
    [
      `Return vs benchmarks (${comparison.startDate} to ${comparison.endDate})`,
      `Account: ${formatPct(comparison.accountPct)}`,
      `Deposit: ${pctOrNa(comparison.depositPct)}`,
      `Buffett (20% a year): ${pctOrNa(comparison.buffettPct)}`,
      `Renaissance (66% a year): ${pctOrNa(comparison.renaissancePct)}`,
    ].join('\n'),
  );
}

export function runCommand(
  name: CommandName,
  context: { pool: Pool; today: string; sources: CommandSources },
): Promise<CommandReply> {
  const sources = { ...databaseSources(context.pool, context.today), ...context.sources };
  switch (name) {
    case 'status':
      return status(context.pool, context.today);
    case 'positions':
      return positions(context.pool, context.today);
    case 'news':
      return news(sources);
    case 'returns':
      return returns(sources);
    case 'day_trade':
    case 'long_hold':
      return choose(context.pool, name);
  }
}

export const helpText = [
  'Commands:',
  '상태 - capital, cash, return',
  '포지션 - open positions',
  '뉴스 - today’s pick and why',
  '수익률 - return vs deposit, Buffett, Renaissance',
  '단타 / 장투 - choose the strategy of the position that is waiting',
].join('\n');
