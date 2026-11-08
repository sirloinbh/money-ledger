import type { Health } from './health';
import { MockAccount } from './mock-account';
import { Page } from './page';
import { SecuritySearch } from './security-search';

export function MockTradingPage({ health }: { health: Health }) {
  return (
    <Page
      title="모의투자"
      description="실제 자산과 분리된 가상 투자금으로 투자를 연습하고 수익률을 확인합니다"
      health={health}
    >
      <MockAccount />
      <SecuritySearch />
    </Page>
  );
}
