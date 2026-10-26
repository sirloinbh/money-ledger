// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/components/layout/에서
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useState } from 'react';
import { applyTheme, readTheme, type ThemeChoice } from '../../lib/theme';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

const LABELS: Record<ThemeChoice, string> = { system: '시스템 설정', light: '라이트', dark: '다크' };
const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon };

function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  const Icon = ICONS[choice];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`화면 모드: ${LABELS[choice]}`}>
          <Icon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>화면 모드</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => {
            const next = value as ThemeChoice;
            applyTheme(next);
            setChoice(next);
          }}
        >
          {(Object.keys(LABELS) as ThemeChoice[]).map((key) => (
            <DropdownMenuRadioItem key={key} value={key}>
              {LABELS[key]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ThemeToggle };
