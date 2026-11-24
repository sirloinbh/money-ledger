import { DailyPick } from './daily-pick';
import type { Health } from './health';
import { MockAccount } from './mock-account';
import { MockPositions } from './mock-positions';
import { Page } from './page';
import { SecuritySearch } from './security-search';

/** #213 Both sections read under `mockKey`: an order placed in either one reloads the account and its cards. */
export function MockTradingPage({ health }: { health: Health }) {
  return (
    <Page
      title="Mock trading"
      description="Practice investing with virtual money kept apart from your real assets and see your returns"
      health={health}
    >
      <DailyPick />
      <MockAccount />
      <MockPositions />
      <SecuritySearch orders />
    </Page>
  );
}
