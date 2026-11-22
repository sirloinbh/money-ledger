import { BudgetProgress } from './budget-progress';
import { CategoryManager } from './categories';
import { RuleManager, UncategorizedEntries } from './classification';
import { EntryManager } from './entries';
import { FixedCostManager } from './fixed-costs';
import type { Health } from './health';
import { MonthlySummary } from './monthly-summary';
import { MonthlyTrend } from './monthly-trend';
import { Page } from './page';

/**
 * #213 Every section loads through the shared query layer under `ledgerKey`: a change in one section reloads the
 * others, so the page passes nothing down (it used to pass version counters).
 */
export function LedgerPage({ health }: { health: Health }) {
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
        <FixedCostManager />
        <EntryManager />
        <UncategorizedEntries />
        <RuleManager />
        <CategoryManager />
      </div>
    </Page>
  );
}
