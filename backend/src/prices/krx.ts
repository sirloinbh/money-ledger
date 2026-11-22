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
// Endpoint names and fields are from secondary sources until the key is issued (#85); see the change log.
const base = 'https://data-dbg.krx.co.kr/svc/apis';
const endpoints: Record<KrxMarket, string> = {
  KOSPI: 'sto/stk_bydd_trd',
  KOSDAQ: 'sto/ksq_bydd_trd',
  KRX_ETF: 'etp/etf_bydd_trd',
};
const label = 'KRX quote';

type KrxItem = { ISU_CD?: unknown; ISU_SRT_CD?: unknown; ISU_NM?: unknown; TDD_CLSPRC?: unknown };

/** Whether an item has the fields this parser reads; their values may still be empty (no trade). */
const hasFields = (item: unknown): item is KrxItem =>
  typeof item === 'object' &&
  item !== null &&
  'ISU_NM' in item &&
  'TDD_CLSPRC' in item &&
  ('ISU_SRT_CD' in item || 'ISU_CD' in item);

/**
 * The rows of one response; rows without a usable code, name or close (no trade that day) are left out. An
 * item without the expected fields is a SourceError, not an empty day (#193): an empty day counts as checked,
 * so a changed response format would otherwise skip trading days without a trace.
 */
export function parseKrxDaily(body: unknown): KrxRow[] {
  const items = (body as { OutBlock_1?: unknown } | null)?.OutBlock_1;
  if (!Array.isArray(items)) throw new SourceError(`${label} response format is not valid`);
  if (!items.every(hasFields)) {
    throw new SourceError(`${label} response is missing the code, name or close fields`);
  }
  const rows: KrxRow[] = [];
  for (const item of items) {
    const code = item.ISU_SRT_CD ?? item.ISU_CD;
    const symbol = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const name = typeof item.ISU_NM === 'string' ? item.ISU_NM.trim() : '';
    const close = decimalText(item.TDD_CLSPRC);
    if (!/^[0-9A-Z]{6}$/.test(symbol) || !name || name.length > 200 || close === null) continue;
    if (close.includes('.')) continue; // KRX closes are whole won
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
