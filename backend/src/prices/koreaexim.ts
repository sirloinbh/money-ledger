import {
  compactDate,
  decimalText,
  type FxSource,
  getOk,
  readJson,
  SourceError,
} from './sources.js';

// Korea Eximbank current exchange rate API, USD deal base rate (docs/price-source.md). Only the new domain
// oapi.koreaexim.go.kr works. The key has to go in the URL, so getOk never puts the URL in an error.
const base = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';
const label = 'Korea Eximbank exchange rate';

type Item = { result?: unknown; cur_unit?: unknown; deal_bas_r?: unknown };

/** The USD rate in one response, or null when the day has no rates (non-business day, before 11:00). */
export function parseEximUsd(body: unknown): string | null {
  if (!Array.isArray(body)) throw new SourceError(`${label} response format is not valid`);
  const items = body as Item[];
  // result 1 is success; 2 is a request error, 3 a key error and 4 the daily limit.
  const failed = items.find((item) => item.result !== undefined && Number(item.result) !== 1);
  if (failed)
    throw new SourceError(`${label} request was rejected (result code ${String(failed.result)})`);
  const usd = items.find((item) => item.cur_unit === 'USD');
  if (!usd) return null;
  const rate = decimalText(usd.deal_bas_r);
  if (rate === null || !/^\d{1,8}(\.\d{1,4})?$/.test(rate)) {
    throw new SourceError(`${label} value is not valid`);
  }
  return rate;
}

export function koreaEximSource(apiKey: string): FxSource {
  return {
    name: 'KOREAEXIM',
    async usd(date) {
      const query = new URLSearchParams({
        authkey: apiKey,
        searchdate: compactDate(date),
        data: 'AP01',
      });
      const response = await getOk(label, `${base}?${query.toString()}`);
      return parseEximUsd(await readJson(label, response));
    },
  };
}
