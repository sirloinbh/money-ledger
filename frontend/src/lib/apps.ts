// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/lib/
// Filled in from the registry (registry/projects.json and platform.json rootDomain, #561).
// The apps the top bar switcher links to. The list is empty while no root domain exists.
export type AppLink = { name: string; label: string; href: string };

export const CURRENT_APP: string = 'money-ledger';

export const APPS: AppLink[] = [
  { name: 'workout-memo', label: 'FORM · My Workout Log', href: 'https://workout-memo.daysofme.com/' },
  { name: 'study-log', label: 'Study Log', href: 'https://study-log.daysofme.com/' },
  { name: 'health-log', label: 'Diet, Sleep and Health Log', href: 'https://health-log.daysofme.com/' },
  { name: 'life-journal', label: 'Reviews & Diary', href: 'https://life-journal.daysofme.com/' },
  { name: 'money-ledger', label: 'Ledger, Assets, Mock Trading', href: 'https://money-ledger.daysofme.com/' },
  { name: 'cert-manager', label: 'Cert Manager', href: 'https://cert-manager.daysofme.com/' },
  { name: 'plan-routine', label: 'Plan · Practice · Routine · Feedback', href: 'https://plan-routine.daysofme.com/' },
  { name: 'dev-career-portfolio', label: 'Dev Career Portfolio', href: 'https://dev-career-portfolio.daysofme.com/' },
  { name: 'file-control', label: 'file-control', href: 'https://github.com/sirloinbh/file-control' },
  { name: 'develop-skill', label: 'develop-skill', href: 'https://wiki.daysofme.com/' },
];
