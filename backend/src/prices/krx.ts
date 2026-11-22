import {
  compactDate,
  decimalText,
  getOk,
  type KrxMarket,
  type KrxRow,
  type KrxSource,
  readJson,
  SourceError,
} from './sources.js';

// KRX Open API daily trading data (docs/price-source.md). The key goes in the AUTH_KEY header.
// Endpoints and fields were checked against real answers on 2026-11-23 (#102): BAS_DD, ISU_CD (already the
// 6-character short code), ISU_NM, TDD_CLSPRC, TDD_OPNPRC, ACC_TRDVOL and more, all as strings. A day's data
// comes out on the next business day; a weekend or holiday answer has no rows or rows with empty values.
const base = 'https://data-dbg.krx.co.kr/svc/apis';
const endpoints: Record<KrxMarket, string> = {
  KOSPI: 'sto/stk_bydd_trd',
  KOSDAQ: 'sto/ksq_bydd_trd',
  KRX_ETF: 'etp/etf_bydd_trd',
};
const label = 'KRX quote';
const readFields = ['ISU_CD', 'ISU_NM', 'TDD_CLSPRC', 'TDD_OPNPRC', 'ACC_TRDVOL'] as const;

type KrxItem = Record<(typeof readFields)[number], unknown>;

/** Whether an item has the fields this parser reads; their values may still be empty (no trade). */
const hasFields = (item: unknown): item is KrxItem =>
  typeof item === 'object' && item !== null && readFields.every((field) => field in item);

/** A KRX number that is exactly zero ("0", "0.00"); empty or "-" is not zero. */
const isZero = (value: unknown) =>
  /^0+(\.0+)?$/.test(
    String(value ?? '')
      .trim()
      .replaceAll(',', ''),
  );

/**
 * The rows of one response. Rows without a usable code, name or close are left out, and so are rows with no
 * trade (volume 0 and open 0): KRX keeps listing a halted security at its last close that way, and such a day
 * counts as missing for the inactive rule (#102). An item without the expected fields is a SourceError, not an
 * empty day (#193): an empty day counts as checked, so a changed response format would otherwise skip trading
 * days, or keep halted securities buyable, without a trace.
 */
export function parseKrxDaily(body: unknown): KrxRow[] {
  const items = (body as { OutBlock_1?: unknown } | null)?.OutBlock_1;
  if (!Array.isArray(items)) throw new SourceError(`${label} response format is not valid`);
  if (!items.every(hasFields)) {
    throw new SourceError(
      `${label} response is missing the code, name, close, open or volume fields`,
    );
  }
  const rows: KrxRow[] = [];
  for (const item of items) {
    const symbol = typeof item.ISU_CD === 'string' ? item.ISU_CD.trim().toUpperCase() : '';
    const name = typeof item.ISU_NM === 'string' ? item.ISU_NM.trim() : '';
    const close = decimalText(item.TDD_CLSPRC);
    if (!/^[0-9A-Z]{6}$/.test(symbol) || !name || name.length > 200 || close === null) continue;
    if (close.includes('.')) continue; // KRX closes are whole won
    if (isZero(item.ACC_TRDVOL) && isZero(item.TDD_OPNPRC)) continue; // no trade: halted (#102)
    rows.push({ symbol, name, close });
  }
  return rows;
}

export function krxSource(apiKey: string): KrxSource {
  return {
    name: 'KRX',
    async daily(market, date) {
      const response = await getOk(
        label,
        `${base}/${endpoints[market]}?basDd=${compactDate(date)}`,
        { AUTH_KEY: apiKey },
      );
      return parseKrxDaily(await readJson(label, response));
    },
  };
}
