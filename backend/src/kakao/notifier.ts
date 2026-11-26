import { type JobLog, logJob } from '../standard/jobs.js';
import { KakaoRevokedError, type Template } from './api.js';
import {
  type BudgetAlert,
  budgetAlertMessage,
  type DailySummary,
  dailySummaryMessage,
  type DayTradeSold,
  dayTradeSoldMessage,
  type LongHoldQuestion,
  longHoldQuestionMessage,
  type PickBought,
  pickBoughtMessages,
} from './messages.js';
import type { Messenger } from './service.js';

// #313 Sends each mock investing event to KakaoTalk. It is called after the trade is saved, and it never throws:
// a failed send is retried once, then logged, and the caller carries on (a send failure never rolls back a trade).

export type KakaoEvent =
  | ({ type: 'pick-bought' } & PickBought)
  | ({ type: 'day-trade-sold' } & DayTradeSold)
  | ({ type: 'long-hold-question' } & LongHoldQuestion)
  | ({ type: 'daily-summary' } & DailySummary)
  | ({ type: 'budget-alert' } & BudgetAlert);

export type Notifier = { notify(event: KakaoEvent): Promise<void> };

const messagesFor = (event: KakaoEvent, link: string): Template[] => {
  switch (event.type) {
    case 'pick-bought':
      return pickBoughtMessages(event, link);
    case 'day-trade-sold':
      return [dayTradeSoldMessage(event, link)];
    case 'long-hold-question':
      return [longHoldQuestionMessage(event, link)];
    case 'daily-summary':
      return [dailySummaryMessage(event, link)];
    case 'budget-alert':
      return [budgetAlertMessage(event, link)];
  }
};

export function createNotifier(
  messenger: Messenger,
  options: { link: string | undefined; log?: JobLog; retryDelayMs?: number },
): Notifier {
  // The button on each message opens the web app; without an app URL the message has no link target.
  const link = options.link ?? '';
  const log = options.log ?? logJob;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // The log gets the event type and the error's message only, never the message text: it holds amounts.
  const sendOnce = async (template: Template) => {
    try {
      await messenger.send(template);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  return {
    async notify(event) {
      try {
        for (const template of messagesFor(event, link)) {
          let failure = await sendOnce(template);
          // A revoked connection will not recover in two seconds: reconnecting in Settings is the fix.
          if (failure && !(failure instanceof KakaoRevokedError)) {
            await wait(retryDelayMs);
            failure = await sendOnce(template);
          }
          if (failure) {
            log({
              level: 'error',
              event: 'kakao_notify_failed',
              type: event.type,
              revoked: failure instanceof KakaoRevokedError,
              message: failure instanceof Error ? failure.message : 'unknown error',
            });
            // The rest of a revoked event would fail the same way, and log the same line again.
            if (failure instanceof KakaoRevokedError) break;
          }
        }
      } catch (error) {
        // Building a message failed (a bad value): still not the caller's problem.
        log({
          level: 'error',
          event: 'kakao_notify_failed',
          type: event.type,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    },
  };
}
