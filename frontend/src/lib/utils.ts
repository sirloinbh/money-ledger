// 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/ui/frontend/src/lib/에서
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Joins class names and lets later Tailwind classes win (shadcn/ui convention).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
