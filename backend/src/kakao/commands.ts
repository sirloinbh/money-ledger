import type { Pool } from 'pg';

import { accountValue } from '../mock/holdings.js';
import type { Template } from './api.js';
import {
  accountSummaryMessage,
  formatWon,
  type NewsReason,
  newsReasonMessage,
  type PositionLine,
  positionsMessage,
} from './messages.js';

// #312 The chatbot commands. Each one returns the text to show; the skill endpoint (skill.ts) wraps it for Kakao.
// The reply text comes from the #311 message builders, so the chatbot and the messages the app sends on its own
// read the same.

export type CommandName = 'status' | 'positions' | 'news' | 'returns';

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
};

export function parseCommand(utterance: string): CommandName | undefined {
  return aliases[utterance.trim().toLowerCase()];
}

/** The quick-reply buttons under every answer: the label and the text sent back when tapped. */
export const quickReplies = ['상태', '포지션', '뉴스', '수익률'] as const;

/** Return of the account next to each benchmark, in percent with 2 decimals, already rounded in SQL. */
export type ReturnComparison = {
  accountPct: string;
  depositPct: string;
  buffettPct: string;
  renaissancePct: string;
};

/** Sources that other features fill in. A missing one makes its command answer "not ready" instead of failing. */
export type CommandSources = {
  news?: () => Promise<NewsReason | undefined>;
  returns?: () => Promise<ReturnComparison | undefined>;
};

export type CommandReply = {
  text: string;
  /** false when the command had nothing to show (no account, no source yet). */
  available: boolean;
};

const link = '/';
const reply = (text: string): CommandReply => ({ text, available: true });
const unavailable = (text: string): CommandReply => ({ text, available: false });

/** The text of a #311 template. Its Kakao link button does not apply inside a chatbot reply. */
const textOf = (template: Template) => String(template.text ?? '');

async function openAccountValue(pool: Pool, today: string) {
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM mock_accounts WHERE closed_at IS NULL',
  );
  const id = rows[0]?.id;
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

async function positions(pool: Pool, today: string): Promise<CommandReply> {
  const value = await openAccountValue(pool, today);
  if (!value) return noAccount();
  const lines: PositionLine[] = value.holdings.map((holding) => ({
    name: holding.security.name ?? holding.security.symbol,
    symbol: holding.security.symbol,
    quantity: holding.quantity,
    // The day trade or long hold choice is stored with #307; until then no position has one.
    strategy: null,
    returnPct: holding.returnPct ?? '0.00',
  }));
  return reply(textOf(positionsMessage(lines, link)));
}

async function news(sources: CommandSources): Promise<CommandReply> {
  const pick = await sources.news?.();
  if (!pick) return unavailable('There is no news pick for today yet.');
  return reply(textOf(newsReasonMessage(pick, link)));
}

async function returns(sources: CommandSources): Promise<CommandReply> {
  const comparison = await sources.returns?.();
  if (!comparison) return unavailable('The return comparison is not ready yet.');
  return reply(
    [
      'Return vs benchmarks',
      `Account: ${comparison.accountPct}%`,
      `Deposit: ${comparison.depositPct}%`,
      `Buffett (20% a year): ${comparison.buffettPct}%`,
      `Renaissance (66% a year): ${comparison.renaissancePct}%`,
    ].join('\n'),
  );
}

export function runCommand(
  name: CommandName,
  context: { pool: Pool; today: string; sources: CommandSources },
): Promise<CommandReply> {
  switch (name) {
    case 'status':
      return status(context.pool, context.today);
    case 'positions':
      return positions(context.pool, context.today);
    case 'news':
      return news(context.sources);
    case 'returns':
      return returns(context.sources);
  }
}

export const helpText = [
  'Commands:',
  '상태 - capital, cash, return',
  '포지션 - open positions',
  '뉴스 - today’s pick and why',
  '수익률 - return vs deposit, Buffett, Renaissance',
].join('\n');
