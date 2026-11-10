import { useState } from 'react';

import { CategoryManager } from './categories';
import { RuleManager, UncategorizedEntries } from './classification';
import { EntryManager } from './entries';
import type { Health } from './health';
import { MonthlySummary } from './monthly-summary';
import { Page } from './page';

export function LedgerPage({ health }: { health: Health }) {
  // Bumped when a category changes, so the entry form offers the current categories.
  const [categoriesVersion, setCategoriesVersion] = useState(0);
  // Bumped when entries or rules change, so the entry list, the uncategorized list and the rules reload.
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const ledgerChanged = () => setLedgerVersion((version) => version + 1);
  return (
    <Page
      title="가계부"
      description="수입과 지출, 고정비를 기록하고 소비 흐름을 확인합니다"
      health={health}
    >
      <div className="flex flex-col gap-10">
        {/* Both counters only grow, so their sum changes whenever entries or category names do. */}
        <MonthlySummary version={ledgerVersion + categoriesVersion} />
        <EntryManager
          categoriesVersion={categoriesVersion}
          entriesVersion={ledgerVersion}
          onChange={ledgerChanged}
        />
        <UncategorizedEntries
          categoriesVersion={categoriesVersion}
          version={ledgerVersion}
          onChange={ledgerChanged}
        />
        <RuleManager
          categoriesVersion={categoriesVersion}
          version={ledgerVersion}
          onChange={ledgerChanged}
        />
        <CategoryManager onChange={() => setCategoriesVersion((version) => version + 1)} />
      </div>
    </Page>
  );
}
