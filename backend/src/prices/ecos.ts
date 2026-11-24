import { type BaseRateRow, type BaseRateSource } from './benchmark-sources.js';
import { compactDate, getOk, readJson, SourceError } from './sources.js';

// Bank of Korea ECOS Open API, StatisticSearch (docs/price-source.md, "Base rate (ECOS)"). The key is part of the
// URL path, so getOk never puts the URL in an error. Table 722Y001, item 0101000, daily cycle: the Bank of Korea
// base rate. Not verified with a real key yet (#304); the parser accepts one row per day or only change days.
const base = 'https://ecos.bok.or.kr/api/StatisticSearch';
const table = '722Y001';
const item = '0101000';
const label = 'ECOS base rate';
// One request returns at most this many rows. Even a row for every day since 2020 is well under it.
const maxRows = 10_000;

type EcosRow = { TIME?: unknown; DATA_VALUE?: unknown };

/** The rows of one ECOS answer; "no data" (INFO-200) is an empty list, any other RESULT code is a failure. */
export function parseEcosRates(body: unknown): BaseRateRow[] {
  const result = (body as { RESULT?: { CODE?: unknown } } | null)?.RESULT;
  if (result !== undefined) {
    if (result?.CODE === 'INFO-200') return [];
    throw new SourceError(`${label} request was rejected (code ${String(result?.CODE)})`);
  }
  const rows = (body as { StatisticSearch?: { row?: unknown } } | null)?.StatisticSearch?.row;
  if (!Array.isArray(rows)) throw new SourceError(`${label} response format is not valid`);
  return (rows as EcosRow[]).map((row) => {
    const time = typeof row.TIME === 'string' ? row.TIME : '';
    const value = typeof row.DATA_VALUE === 'string' ? row.DATA_VALUE.trim() : '';
    if (!/^\d{8}$/.test(time) || !/^\d{1,2}(\.\d{1,4})?$/.test(value)) {
      throw new SourceError(`${label} value is not valid`);
    }
    return { date: `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}`, ratePct: value };
  });
}

export function ecosBaseRateSource(apiKey: string): BaseRateSource {
  return {
    name: 'ECOS',
    async rates(start, end) {
      const url = `${base}/${encodeURIComponent(apiKey)}/json/kr/1/${maxRows}/${table}/D/${compactDate(start)}/${compactDate(end)}/${item}`;
      return parseEcosRates(await readJson(label, await getOk(label, url)));
    },
  };
}
