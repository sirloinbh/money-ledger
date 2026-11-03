import { useState } from 'react';

import { CategoryManager } from './categories';
import { EntryManager } from './entries';
import type { Health } from './health';
import { Page } from './page';

export function LedgerPage({ health }: { health: Health }) {
  // Bumped when a category changes, so the entry form offers the current categories.
  const [categoriesVersion, setCategoriesVersion] = useState(0);
  return (
    <Page
      title="가계부"
      description="수입과 지출, 고정비를 기록하고 소비 흐름을 확인합니다"
      health={health}
    >
      <div className="flex flex-col gap-10">
        <EntryManager categoriesVersion={categoriesVersion} />
        <CategoryManager onChange={() => setCategoriesVersion((version) => version + 1)} />
      </div>
    </Page>
  );
}
