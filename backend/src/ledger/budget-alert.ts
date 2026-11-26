import type { Pool } from 'pg';

import type { Notifier } from '../kakao/notifier.js';
import type { KakaoService } from '../kakao/service.js';
import { won } from '../money.js';
import { serviceDate } from '../standard/http.js';
import { type JobLog, type JobQueue, logJob } from '../standard/jobs.js';
import { budgetListSql, type BudgetRow } from './budgets.js';

// #299 A KakaoTalk "send to me" alert when a category's spending reaches or passes its monthly budget (the same
// line the app calls overspending, #61). At most one alert per budget per month: the alert is claimed in
// budget_alerts_sent before it is sent, so a second run, or two runs at once, send nothing more. Raising the
// budget afterwards does not alert again that month. A send that fails is logged by the notifier and is not
// retried on the next run (the claim stays), which keeps a broken connection from repeating alerts.

export const BUDGET_ALERT_QUEUE = 'budget-alert';

export async function sendBudgetAlerts(
  pool: Pool,
  notifier: Notifier,
  day: string,
  options: { connected: () => Promise<boolean>; log?: JobLog },
) {
  const log = options.log ?? logJob;
  // Not connected (or revoked): claim nothing, so the alert goes out once KakaoTalk is connected.
  if (!(await options.connected())) {
    log({ level: 'info', event: 'budget_alert_skipped', reason: 'not-connected', day });
    return 0;
  }
  const month = day.slice(0, 7);
  const { rows } = await pool.query<BudgetRow>(budgetListSql, [`${month}-01`]);
  let sent = 0;
  for (const row of rows) {
    if (row.status !== 'reached' && row.status !== 'over') continue;
    const claimed = await pool.query(
      `INSERT INTO budget_alerts_sent (category_id, month, status) VALUES ($1, $2::date, $3)
       ON CONFLICT (category_id, month) DO NOTHING`,
      [row.category_id, `${month}-01`, row.status],
    );
    if (claimed.rowCount === 0) continue;
    await notifier.notify({
      type: 'budget-alert',
      month,
      categoryName: row.name,
      status: row.status,
      spentKrw: won(row.spent),
      budgetKrw: won(row.budget as string),
      percent: row.percent as string,
    });
    sent += 1;
  }
  return sent;
}

/**
 * The alert check as a pg-boss queue: every 30 minutes from 08:00 to 22:30 in Asia/Seoul. A budget crossed by an
 * entry is alerted within half an hour; a `singleton` policy keeps one run at a time.
 */
export function budgetAlertQueue(
  pool: Pool,
  notifier: Notifier,
  kakao: Pick<KakaoService, 'status'>,
  today: () => string = () => serviceDate(),
): JobQueue {
  return {
    name: BUDGET_ALERT_QUEUE,
    policy: 'singleton',
    retryLimit: 2,
    retryDelay: 60,
    schedule: '*/30 8-22 * * *',
    handler: async () => {
      await sendBudgetAlerts(pool, notifier, today(), {
        connected: async () => (await kakao.status()).state === 'connected',
      });
    },
  };
}
