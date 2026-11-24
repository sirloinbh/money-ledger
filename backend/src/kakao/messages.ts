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
  const body = joined.length > textLimit ? `${joined.slice(0, textLimit - 1)}…` : joined;
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
