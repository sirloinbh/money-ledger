import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { BudgetProgress } from './budget-progress';
import { CategoryManager } from './categories';
import { RuleManager, UncategorizedEntries } from './classification';
import { EntryManager } from './entries';
import { FixedCostManager } from './fixed-costs';
import type { Health } from './health';
import { ledgerKey } from './ledger-query';
import { MonthlySummary } from './monthly-summary';
import { MonthlyTrend } from './monthly-trend';
import { Page } from './page';

export function LedgerPage({ health }: { health: Health }) {
  const client = useQueryClient();
  // #213 Sections on the shared query layer reload through `ledgerKey`; the counters below are for the sections
  // that still load by hand (fixed costs and entries), until they move over too.
  // Bumped when a category changes, so the entry form offers the current categories.
  const [categoriesVersion, setCategoriesVersion] = useState(0);
  // Bumped when entries, rules or fixed costs change, so the fixed costs and the entry list reload.
  const [ledgerVersion, setLedgerVersion] = useState(0);
  // A change in a section on the counters: the other counter sections reload, and so does every query section.
  const ledgerChanged = () => {
    setLedgerVersion((version) => version + 1);
    void client.invalidateQueries({ queryKey: ledgerKey });
  };
  // A change in a query section: it reloads every query section itself, so only the counters move.
  const queryLedgerChanged = () => setLedgerVersion((version) => version + 1);
  const queryCategoriesChanged = () => setCategoriesVersion((version) => version + 1);
  return (
    <Page
      title="Ledger"
      description="Record income, expenses, and fixed costs, and see how you spend"
      health={health}
    >
      <div className="flex flex-col gap-10">
        <MonthlySummary />
        <BudgetProgress />
        <MonthlyTrend />
        {/* Both counters only grow, so their sum changes whenever entries or category names do. */}
        <FixedCostManager version={ledgerVersion + categoriesVersion} onChange={ledgerChanged} />
        <EntryManager
          categoriesVersion={categoriesVersion}
          entriesVersion={ledgerVersion}
          onChange={ledgerChanged}
        />
        <UncategorizedEntries onChange={queryLedgerChanged} />
        <RuleManager onChange={queryLedgerChanged} />
        <CategoryManager onChange={queryCategoriesChanged} />
      </div>
    </Page>
  );
}
