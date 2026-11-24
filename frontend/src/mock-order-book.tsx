import { Button } from './components/ui/button';
import { formatDecimal } from './format';
import { apiKey, useApiQuery } from './lib/query';

// #305 The live order book of a Korean security above the mock order form: ask levels above (highest first, so the
// best ask sits next to the best bid), bid levels below. Prices and quantities arrive as strings and are only
// formatted here. Under the mock key, so an order refreshes it like every other mock read (#213).

type Level = { price: string; quantity: string };
type Book = { securityId: number; price: string; asks: Level[]; bids: Level[]; readAt: string };

const seoulTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function Rows({ levels, side }: { levels: Level[]; side: 'ask' | 'bid' }) {
  return levels.map((level) => (
    <tr
      key={`${side}-${level.price}`}
      className={
        side === 'ask' ? 'text-blue-700 dark:text-blue-300' : 'text-red-700 dark:text-red-300'
      }
    >
      <td className="py-0.5 pr-4 text-right tabular-nums">{formatDecimal(level.price)}</td>
      <td className="py-0.5 text-right tabular-nums">{formatDecimal(level.quantity)}</td>
    </tr>
  ));
}

export function MockOrderBook({ securityId, title }: { securityId: number; title: string }) {
  const query = useApiQuery<Book>(
    apiKey('/api/mock', 'quotes', securityId),
    `/api/mock/quotes/${securityId}`,
  );
  const book = query.data;
  const asks = book && Array.isArray(book.asks) ? [...book.asks].reverse() : null;
  return (
    <section aria-label={`${title} order book`} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-body font-semibold">Order book</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-busy={query.isFetching || undefined}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {query.isError ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          {query.error.message}
        </p>
      ) : !book || !asks || !Array.isArray(book.bids) ? (
        <p role="status" className="text-body-sm text-muted-foreground">
          {query.isPending ? 'Loading the order book…' : 'No order book'}
        </p>
      ) : (
        <>
          <table className="w-full max-w-xs text-body-sm">
            <caption className="sr-only">
              {`Order book of ${title}: asks above, bids below`}
            </caption>
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th scope="col" className="pr-4 text-right font-normal">
                  Price (₩)
                </th>
                <th scope="col" className="text-right font-normal">
                  Shares
                </th>
              </tr>
            </thead>
            <tbody aria-label="Asks">
              <Rows levels={asks} side="ask" />
            </tbody>
            <tbody aria-label="Bids" className="border-t">
              <Rows levels={book.bids} side="bid" />
            </tbody>
          </table>
          <p className="text-caption text-muted-foreground">
            Last ₩{formatDecimal(book.price)} · read at {seoulTime.format(new Date(book.readAt))}{' '}
            KST
          </p>
        </>
      )}
    </section>
  );
}
