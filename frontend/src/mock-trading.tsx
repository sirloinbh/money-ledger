import { useState } from 'react';

import type { Health } from './health';
import { MockAccount } from './mock-account';
import { Page } from './page';
import { SecuritySearch } from './security-search';

export function MockTradingPage({ health }: { health: Health }) {
  // Bumped after each filled order (from a holding or a security's detail) so the account card reloads.
  const [orders, setOrders] = useState(0);
  const ordered = () => setOrders((count) => count + 1);
  return (
    <Page
      title="Mock trading"
      description="Practice investing with virtual money kept apart from your real assets and see your returns"
      health={health}
    >
      <MockAccount refreshKey={orders} onOrdered={ordered} />
      <SecuritySearch onOrdered={ordered} />
    </Page>
  );
}
