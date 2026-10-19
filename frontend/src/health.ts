export type Health =
  { state: 'loading' } | { state: 'ok'; today: string } | { state: 'error'; message: string };

export function healthText(health: Health) {
  if (health.state === 'loading') return '서버 확인 중…';
  if (health.state === 'ok') return `서버 연결됨 · ${health.today}`;
  return health.message;
}
