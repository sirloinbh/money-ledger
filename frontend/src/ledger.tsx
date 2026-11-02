import { Link } from 'react-router';

import { Button } from './components/ui/button';
import type { Health } from './health';
import { Page } from './page';

export function LedgerPage({ health, categoriesPath }: { health: Health; categoriesPath: string }) {
  return (
    <Page
      title="가계부"
      description="수입과 지출, 고정비를 기록하고 소비 흐름을 확인합니다"
      emptyDescription="수입·지출 내역 기능을 추가하면 여기에 표시됩니다."
      emptyAction={
        <Button asChild variant="outline">
          <Link to={categoriesPath}>카테고리 관리</Link>
        </Button>
      }
      health={health}
    />
  );
}
