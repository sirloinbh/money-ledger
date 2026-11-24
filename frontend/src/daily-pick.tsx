import { Badge } from './components/ui/badge';
import { Notice } from './components/ui/notice';
import { apiKey, useApiQuery } from './lib/query';
import { useNotice } from './lib/use-notice';
import { useLoadError } from './query-reads';

// #308 The day's Claude pick: the story, its effect on the economy, the reasoning, the stock, and the news
// behind it. Everything comes from the server; this card only shows it.

type Pick = {
  id: number;
  date: string;
  storyTitle: string;
  storySummary: string;
  economicEffect: string;
  reasoning: string;
  model: string;
  orderId: number | null;
  security: { id: number; symbol: string; name: string | null; market: string };
  news: { id: number; title: string; link: string; publisher: string | null }[];
};
type Data = { date: string; pick: Pick | null };

const pickKey = apiKey('/api/picks');

export function DailyPick() {
  const read = useApiQuery<Data>(pickKey, '/api/picks');
  const { notice, error: showError } = useNotice();
  useLoadError(read.error, showError, "Could not load today's pick");
  const pick = read.data?.pick;

  return (
    <section aria-labelledby="daily-pick-title" className="flex flex-col gap-3">
      <h3 id="daily-pick-title" className="text-body font-semibold">
        Today&apos;s Claude pick
      </h3>
      <Notice id="daily-pick-notice" notice={notice} />
      {!read.data ? (
        notice?.kind === 'error' ? null : (
          <p className="text-body-sm text-muted-foreground">Loading today&apos;s pick</p>
        )
      ) : !pick ? (
        <p className="text-body-sm text-muted-foreground">
          No pick yet today. Claude picks at 08:00 on weekdays, after the morning news is collected.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold break-words">
              {pick.security.name ?? pick.security.symbol}
              <span className="ml-2 text-body-sm font-normal text-muted-foreground">
                {pick.security.symbol}
              </span>
            </p>
            <Badge variant="secondary">{pick.orderId === null ? 'Not bought yet' : 'Bought'}</Badge>
          </div>
          <dl className="flex flex-col gap-2 text-body-sm">
            {(
              [
                ['Story', `${pick.storyTitle}. ${pick.storySummary}`],
                ['Effect on the economy', pick.economicEffect],
                ['Why this stock', pick.reasoning],
              ] as const
            ).map(([label, text]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{text}</dd>
              </div>
            ))}
          </dl>
          <div>
            <p className="text-body-sm text-muted-foreground">News behind it</p>
            <ul className="list-disc pl-5 text-body-sm">
              {pick.news.map((item) => (
                <li key={item.id} className="break-words">
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {item.title}
                  </a>
                  {item.publisher ? ` (${item.publisher})` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
