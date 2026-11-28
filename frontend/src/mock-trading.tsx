import { DailyPick } from './daily-pick';
import type { Health } from './health';
import { MockAccount } from './mock-account';
import { MockKeepOrSell } from './mock-keep-or-sell';
import { MockPositions } from './mock-positions';
import { Page } from './page';
import { SecuritySearch } from './security-search';

/** #213 Both sections read under `mockKey`: an order placed in either one reloads the account and its cards. */
export function MockTradingPage({ health }: { health: Health }) {
  return (
    <Page title="Mock trading" health={health}>
      <DailyPick />
      <MockAccount />
      <MockKeepOrSell />
      <MockPositions />
      <SecuritySearch orders />
    </Page>
  );
}
