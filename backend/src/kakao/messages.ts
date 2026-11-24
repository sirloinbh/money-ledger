import type { Template } from './api.js';

// #311 Message builders. They take server values (whole-won integers, decimal strings the SQL already rounded) and
// only format them: no money arithmetic happens here, so no float math touches an amount.

/** Kakao's text template holds at most 200 characters. */
const textLimit = 200;

const won = new Intl.NumberFormat('en-US');
export const formatWon = (amount: number) =>
  `${amount < 0 ? '-' : ''}₩${won.format(Math.abs(amount))}`;

/** "13.31" → "+13.31%", "-1.72" → "-1.72%", "0.00" → "0.00%". Works on the string, never on a number. */
export function formatPct(pct: string) {
  const signed = pct.startsWith('-') || /^0+(\.0+)?$/.test(pct) ? pct : `+${pct}`;
  return `${signed}%`;
}

const decimal = (text: string) => {
  const [whole, fraction = ''] = text.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
};

function text(lines: string[], link: string): Template {
  const joined = lines.join('\n');
  // Cut by code points, so an emoji is never split in half.
  const chars = Array.from(joined);
  const body = chars.length > textLimit ? `${chars.slice(0, textLimit - 1).join('')}…` : joined;
  return {
    object_type: 'text',
    text: body,
    link: { web_url: link, mobile_web_url: link },
    button_title: 'Open Money Ledger',
  };
}

export type AccountSummary = {
  /** The starting amount of the account. */
  capitalKrw: number;
  cashKrw: number;
  totalValueKrw: number;
  profitKrw: number;
  /** Return in percent with 2 decimals, already rounded in SQL. */
  returnPct: string;
};

export const accountSummaryMessage = (summary: AccountSummary, link: string) =>
  text(
    [
      'Mock account summary',
      `Capital: ${formatWon(summary.capitalKrw)}`,
      `Cash: ${formatWon(summary.cashKrw)}`,
      `Total value: ${formatWon(summary.totalValueKrw)}`,
      `Return: ${formatPct(summary.returnPct)} (${formatWon(summary.profitKrw)})`,
    ],
    link,
  );

export type PositionLine = {
  name: string;
  symbol: string;
  /** Decimal string, e.g. "12.00000000". */
  quantity: string;
  /** null while the day trade or long hold choice is still open. */
  strategy: 'day' | 'long' | null;
  returnPct: string;
};

const strategyLabel = { day: 'day trade', long: 'long hold' } as const;

export function positionsMessage(positions: PositionLine[], link: string) {
  if (positions.length === 0) return text(['Open positions', 'No open positions.'], link);
  const lines = positions.map(
    (p) =>
      `${p.name} (${p.symbol}) ${decimal(p.quantity)} sh, ${p.strategy ? strategyLabel[p.strategy] : 'strategy not chosen'}, ${formatPct(p.returnPct)}`,
  );
  return text(['Open positions', ...lines], link);
}

export type NewsReason = {
  headline: string;
  /** Claude's reading of the effect on the economy. */
  effect: string;
  stockName: string;
  symbol: string;
  reason: string;
};

export const newsReasonMessage = (news: NewsReason, link: string) =>
  text(
    [
      `News: ${news.headline}`,
      `Effect: ${news.effect}`,
      `Pick: ${news.stockName} (${news.symbol})`,
      `Why: ${news.reason}`,
    ],
    link,
  );

export const testMessage = (link: string) =>
  text(['Money Ledger test message', 'KakaoTalk is connected.'], link);

// #313 Event messages. A story needs more than Kakao's 200 characters, so an event can be several messages, sent in order.

export type PickBought = {
  news: NewsReason;
  stockName: string;
  symbol: string;
  /** Decimal string, e.g. "12.00000000". */
  quantity: string;
  /** Fill price per share in won (the best ask). */
  priceKrw: number;
  /** What the buy cost in total, fees included. */
  amountKrw: number;
};

export const pickBoughtMessages = (event: PickBought, link: string) => [
  // Three messages, each under the 200 character limit on its own, so the reasoning is not cut off by the headline.
  text([`News: ${event.news.headline}`, `Effect: ${event.news.effect}`], link),
  text([`Pick: ${event.news.stockName} (${event.news.symbol})`, `Why: ${event.news.reason}`], link),
  // The question comes first: it is the line that must never be cut.
  text(
    [
      'Day trade or long hold? Reply 단타 or 장투',
      `Bought ${event.stockName} (${event.symbol})`,
      `${decimal(event.quantity)} sh at ${formatWon(event.priceKrw)}`,
      `Cost: ${formatWon(event.amountKrw)}`,
    ],
    link,
  ),
];

export type DayTradeSold = {
  reason: 'take-profit' | 'stop-loss';
  stockName: string;
  symbol: string;
  quantity: string;
  /** Sell price per share in won (the best bid). */
  priceKrw: number;
  /** Gain after fees and tax; negative for a loss. */
  netGainKrw: number;
  netGainPct: string;
  /** The account's total value after the sale. */
  capitalKrw: number;
};

const soldLabel = { 'take-profit': 'Take profit', 'stop-loss': 'Stop loss' } as const;

export const dayTradeSoldMessage = (event: DayTradeSold, link: string) =>
  text(
    [
      `${soldLabel[event.reason]}: sold ${event.stockName} (${event.symbol})`,
      `${decimal(event.quantity)} sh at ${formatWon(event.priceKrw)}`,
      `Net gain: ${formatWon(event.netGainKrw)} (${formatPct(event.netGainPct)})`,
      `Capital: ${formatWon(event.capitalKrw)}`,
    ],
    link,
  );

export type LongHoldQuestion = {
  stockName: string;
  symbol: string;
  quantity: string;
  priceKrw: number;
  returnPct: string;
};

export const longHoldQuestionMessage = (event: LongHoldQuestion, link: string) =>
  text(
    [
      `Keep or sell ${event.stockName} (${event.symbol})?`,
      `${decimal(event.quantity)} sh, last ${formatWon(event.priceKrw)}, ${formatPct(event.returnPct)}`,
      'Reply 유지 or 매도. No answer by 15:00 means keep.',
    ],
    link,
  );

/** Returns in percent since the account started, for the same period as the account's own return. */
export type Comparison = { depositPct: string; buffettPct: string; renaissancePct: string };

export type DailySummary = { summary: AccountSummary; comparison?: Comparison };

export const dailySummaryMessage = ({ summary, comparison }: DailySummary, link: string) =>
  text(
    [
      'Daily summary',
      `Total value: ${formatWon(summary.totalValueKrw)}`,
      `Return: ${formatPct(summary.returnPct)} (${formatWon(summary.profitKrw)})`,
      `Cash: ${formatWon(summary.cashKrw)}`,
      ...(comparison
        ? [
            `Deposit ${formatPct(comparison.depositPct)} · Buffett ${formatPct(comparison.buffettPct)} · Renaissance ${formatPct(comparison.renaissancePct)}`,
          ]
        : []),
    ],
    link,
  );
