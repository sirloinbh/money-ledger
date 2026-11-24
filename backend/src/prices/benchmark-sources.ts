// #294 The Bank of Korea base rate source (docs/price-source.md, "Base rate (ECOS)"). Like the price sources it is
// optional: without a key the fetch skips it and the deposit comparison says there is no rate yet.

/** `ratePct` is the annual base rate in percent, as a decimal string. */
export type BaseRateRow = { date: string; ratePct: string };

export type BaseRateSource = {
  readonly name: string;
  /** Rows published from `start` to `end`: the days the rate was set or changed, or every day. */
  rates(start: string, end: string): Promise<BaseRateRow[]>;
};

/** A deterministic stand-in for tests and for running without a key (PRICE_SOURCE=fake): 2.5% since 2025-05-29. */
export function fakeBaseRateSource(): BaseRateSource {
  const since = '2025-05-29';
  return {
    name: 'FAKE',
    rates: (start, end) =>
      Promise.resolve(start <= since && end >= since ? [{ date: since, ratePct: '2.5' }] : []),
  };
}
