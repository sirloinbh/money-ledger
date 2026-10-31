// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// tailwind-merge cannot see the text styles in @sirloinbh/design-tokens (@utility text-body, ...), so it
// takes them for text colours and text-destructive removes them. Listing them as font sizes keeps both.
// project-standards scripts/test/cn-text-styles.test.mjs fails if this list and the tokens differ.
const TEXT_STYLES = ['body', 'body-sm', 'caption', 'meta'];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: TEXT_STYLES }] } },
});

// Joins class names and lets later Tailwind classes win (shadcn/ui convention).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
