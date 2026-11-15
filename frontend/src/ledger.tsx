import { useState } from 'react';

import { BudgetProgress } from './budget-progress';
import { CategoryManager } from './categories';
import { RuleManager, UncategorizedEntries } from './classification';
import { EntryManager } from './entries';
import type { Health } from './health';
import { MonthlySummary } from './monthly-summary';
import { MonthlyTrend } from './monthly-trend';
import { Page } from './page';

export function LedgerPage({ health }: { health: Health }) {
  // Bumped when a category changes, so the entry form offers the current categories.
  const [categoriesVersion, setCategoriesVersion] = useState(0);
  // Bumped when entries or rules change, so the entry list, the uncategorized list and the rules reload.
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const ledgerChanged = () => setLedgerVersion((version) => version + 1);
  return (
    <Page
      title="Ledger"
      description="Record income, expenses, and fixed costs, and see how you spend"
      health={health}
    >
      <div className="flex flex-col gap-10">
        {/* Both counters only grow, so their sum changes whenever entries or category names do. */}
        <MonthlySummary version={ledgerVersion + categoriesVersion} />
        <BudgetProgress version={ledgerVersion + categoriesVersion} />
        <MonthlyTrend version={ledgerVersion} />
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
