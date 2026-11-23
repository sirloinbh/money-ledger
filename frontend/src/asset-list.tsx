import { type RefObject, useState } from 'react';

import {
  type Asset,
  depreciationText,
  prepaidText,
  type Totals,
  totalText,
  tradeableTypes,
  typeLabels,
  typeOrder,
  valuationLines,
  valueText,
} from './asset-model';
import { AssetTrades } from './asset-trades';
import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { countOf, formatDecimal } from './format';
import { PrepaidUsages } from './prepaid-usages';
import { securityText } from './quote-format';

// #190 The totals and the asset list, grouped by type, with each row's usage and trade panels.

export function Summary({ totals }: { totals: Totals }) {
  const items = [
    { label: 'Total assets', value: totalText(totals.assetsKrw) },
    { label: 'Total liabilities', value: totalText(totals.debtsKrw) },
    {
      label: 'Net worth',
      value: totalText(totals.netKrw),
    },
  ];
  return (
    <section aria-label="Totals" className="flex flex-col gap-2">
      <dl className="grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col gap-1 rounded-xl border px-4 py-3">
            <dt className="text-body-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-muted-foreground">
        Liabilities are not added to the asset total; they are only subtracted from net worth.
        {totals.uncounted > 0
          ? ` ${countOf(totals.uncounted, 'item')} without a quote, exchange rate, or valuation ${totals.uncounted === 1 ? 'is' : 'are'} left out of the totals.`
          : ''}
      </p>
    </section>
  );
}

export function AssetList({
  assets,
  failed,
  onEdit,
  onDelete,
  returnFocusRef,
  onDeleteOpen,
}: {
  assets: Asset[] | undefined;
  failed: boolean;
  onEdit: (asset: Asset) => void;
  onDelete: (asset: Asset) => Promise<void>;
  returnFocusRef: RefObject<HTMLElement | null>;
  onDeleteOpen: () => void;
}) {
  // The stored-value asset whose uses are open, one at a time.
  const [openUsages, setOpenUsages] = useState<number | undefined>(undefined);
  // The stock or other asset whose trades are open, one at a time.
  const [openTrades, setOpenTrades] = useState<number | undefined>(undefined);
  if (assets === undefined) {
    return failed ? null : <p className="text-body-sm text-muted-foreground">Loading assets</p>;
  }
  if (assets.length === 0) {
    return <p className="text-body-sm text-muted-foreground">No assets registered yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {typeOrder
        .filter((type) => assets.some((asset) => asset.type === type))
        .map((type) => (
          <section key={type} aria-labelledby={`assets-${type}`} className="flex flex-col gap-2">
            <h3 id={`assets-${type}`} className="text-body font-semibold">
              {typeLabels[type]}
            </h3>
            <ul
              aria-labelledby={`assets-${type}`}
              className="flex flex-col divide-y rounded-xl border"
            >
              {assets
                .filter((asset) => asset.type === type)
                .map((asset) => (
                  <li
                    key={asset.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium break-words">{asset.name}</span>
                      <span className="text-body-sm text-muted-foreground">
                        {asset.depreciation
                          ? depreciationText(asset.depreciation)
                          : asset.prepaid
                            ? prepaidText(asset.prepaid)
                            : asset.security
                              ? `${securityText(asset.security)} · ${asset.currency}`
                              : asset.currency}
                        {asset.quantity === null
                          ? ''
                          : ` · quantity ${formatDecimal(asset.quantity)}`}
                        {asset.memo ? ` · ${asset.memo}` : ''}
                      </span>
                      {valuationLines(asset).map((line) => (
                        <span key={line} className="text-caption text-muted-foreground">
                          {line}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium tabular-nums">{valueText(asset)}</span>
                      {asset.prepaid?.kind === 'amount' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={openUsages === asset.id}
                          // Only while the panel exists, so it never points at a missing id.
                          aria-controls={
                            openUsages === asset.id ? `usage-${asset.id}-panel` : undefined
                          }
                          aria-label={`${asset.name} usage records`}
                          onClick={() =>
                            setOpenUsages((open) => (open === asset.id ? undefined : asset.id))
                          }
                        >
                          Usage records
                        </Button>
                      ) : null}
                      {tradeableTypes.includes(asset.type) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-expanded={openTrades === asset.id}
                          aria-controls={
                            openTrades === asset.id ? `trade-${asset.id}-panel` : undefined
                          }
                          aria-label={`${asset.name} trades`}
                          onClick={() =>
                            setOpenTrades((open) => (open === asset.id ? undefined : asset.id))
                          }
                        >
                          Trades
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${asset.name}`}
                        onClick={() => onEdit(asset)}
                      >
                        Edit
                      </Button>
                      <ConfirmDialog
                        title="Delete this asset?"
                        description={`${asset.name}. Deleting it cannot be undone.`}
                        onConfirm={() => onDelete(asset)}
                        returnFocusRef={returnFocusRef}
                        onOpenChange={(open) => {
                          if (open) onDeleteOpen();
                        }}
                        trigger={
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={`Delete ${asset.name}`}
                          >
                            Delete
                          </Button>
                        }
                      />
                    </div>
                    {asset.prepaid?.kind === 'amount' && openUsages === asset.id ? (
                      <div id={`usage-${asset.id}-panel`} className="w-full">
                        <PrepaidUsages assetId={asset.id} assetName={asset.name} />
                      </div>
                    ) : null}
                    {tradeableTypes.includes(asset.type) && openTrades === asset.id ? (
                      <div id={`trade-${asset.id}-panel`} className="w-full">
                        <AssetTrades
                          assetId={asset.id}
                          assetName={asset.name}
                          currency={asset.currency}
                          handQuantity={asset.hasTrades ? null : asset.quantity}
                          latestFx={asset.fx}
                        />
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
