// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/
export type Health =
  { state: 'loading' } | { state: 'ok'; today: string } | { state: 'error'; message: string };

export function healthText(health: Health) {
  if (health.state === 'loading') return 'Checking server…';
  if (health.state === 'ok') return `Server connected · ${health.today}`;
  return health.message;
}
