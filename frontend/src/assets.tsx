import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { type Allocation, AssetAllocation } from './asset-allocation';
import { AssetForm } from './asset-form';
import { AssetList, Summary } from './asset-list';
import {
  type Asset,
  assetsPath,
  type Draft,
  draftFromAsset,
  emptyDraft,
  type Field,
  toBody,
  type Totals,
  typeLabel,
} from './asset-model';
import { Notice } from './components/ui/notice';
import { formatDecimal } from './format';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

// #45 Held assets and debts. Won values are numbers, quantities and USD values decimal strings (#35 rules).
// Trades come with #46.
// #47 A stock can be linked to a security and is valued at the stored close; an unlinked stock or other asset
// can take a price entered by hand. USD values are converted with the newest stored USD rate, and assets with
// trades show their gain against the won cost (decisions 2026-11-10).
// #63 A depreciating asset is entered as a purchase price, date and useful life; the server returns its
// current value (straight-line by month, never below the salvage value).
// #64 A prepaid asset is a stored value (voucher, lowered by uses) or a pass (lowered by the day);
// the server returns its current value. Paying is a ledger expense, so a use is not recorded as one again.
// #190 Types and pure helpers are in asset-model.ts, the form in asset-form.tsx, the list in asset-list.tsx.

/** GET /api/portfolio/assets */
export type AssetsAnswer = { assets: Asset[]; totals: Totals; allocation: Allocation };

/** `afterAllocation` goes right under the allocation card (#49: the net worth history). */
export function AssetManager({ afterAllocation }: { afterAllocation?: ReactNode } = {}) {
  const [assets, setAssets] = useState<Asset[] | undefined>(undefined);
  const [totals, setTotals] = useState<Totals | undefined>(undefined);
  const [allocation, setAllocation] = useState<Allocation | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<Asset | undefined>(undefined);
  const tradeManaged = editing?.hasTrades === true;
  const [invalid, setInvalid] = useState<Field | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  // Where the delete dialog returns focus: empty (back to its trigger) unless the delete went through.
  const afterDelete = useRef<HTMLElement | null>(null);
  const notice = useNotice();
  const { error: showError, status: showStatus } = notice;

  // #189 Loads overlap (a save's reload, a voucher use's reload): only the newest request's answer is shown,
  // so an older response that arrives last cannot put stale rows back.
  const latestLoad = useRef(0);
  const load = useCallback(async () => {
    const request = ++latestLoad.current;
    let data: AssetsAnswer;
    try {
      data = await requestJson(assetsPath);
    } catch (cause) {
      // A superseded load's failure says nothing about the list shown now.
      if (request !== latestLoad.current) return;
      throw cause;
    }
    if (request !== latestLoad.current) return;
    setAssets(data.assets);
    setTotals(data.totals);
    setAllocation(data.allocation);
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) => showError(cause, 'Could not load the assets'));
  }, [load, showError]);

  // Opening an edit moves focus to the form above the list (not when the same asset is refreshed below).
  const editingId = editing?.id;
  useEffect(() => {
    if (editingId !== undefined) nameInput.current?.focus();
  }, [editingId]);

  // #46 A trade saved while the asset is open in the form changes whether its quantity comes from trades
  // and what it is: follow the fresh asset so the form never sends a quantity the server will refuse.
  useEffect(() => {
    if (!editing || !assets) return;
    const fresh = assets.find((asset) => asset.id === editing.id);
    if (!fresh) {
      // Deleted elsewhere (another tab): there is nothing left to save.
      setInvalid(undefined);
      setEditing(undefined);
      setDraft(emptyDraft());
      showError(`${editing.name} was already deleted, so the edit was closed`);
      return;
    }
    if (fresh.hasTrades === editing.hasTrades && fresh.quantity === editing.quantity) return;
    setEditing(fresh);
    if (fresh.hasTrades || editing.hasTrades) {
      setDraft((current) => ({
        ...current,
        quantity: fresh.quantity === null ? '' : formatDecimal(fresh.quantity),
      }));
    }
  }, [assets, editing, showError]);

  const change = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const clearInvalid = (field: Field) => {
    if (invalid === field) setInvalid(undefined);
  };

  const startEdit = (asset: Asset) => {
    if (saving.current) return;
    setInvalid(undefined);
    setEditing(asset);
    setDraft(draftFromAsset(asset));
    notice.clear();
  };

  const stopEdit = () => {
    setInvalid(undefined);
    setEditing(undefined);
    setDraft(emptyDraft());
  };

  // The change is saved even when the reload fails, so this is a note, not an error (#203).
  const reload = async (done: string) => {
    try {
      await load();
      showStatus(done);
    } catch {
      showStatus(`${done}. The list could not be reloaded; reload the page to see it`);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current) return;
    const result = toBody(draft, tradeManaged);
    if ('field' in result) {
      setInvalid(result.field);
      showError(result.message);
      return;
    }
    setInvalid(undefined);
    saving.current = true;
    setBusy(true);
    try {
      try {
        await (editing
          ? requestJson(`${assetsPath}/${editing.id}`, { method: 'PUT', body: result.body })
          : requestJson(assetsPath, { method: 'POST', body: result.body }));
      } catch (cause) {
        showError(cause);
        return;
      }
      const done = editing ? `${draft.name.trim()} updated` : `${draft.name.trim()} added`;
      if (editing) stopEdit();
      else setDraft(emptyDraft());
      await reload(done);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  const remove = async (asset: Asset) => {
    if (saving.current) {
      showError('Saving in progress. Try again in a moment');
      throw new Error('saving'); // keeps the dialog open
    }
    // #189 A delete holds the same guard as a save, so the form cannot submit while it runs.
    saving.current = true;
    setBusy(true);
    try {
      try {
        await requestJson(`${assetsPath}/${asset.id}`, { method: 'DELETE' });
      } catch (cause) {
        showError(cause);
        throw cause;
      }
      afterDelete.current = listTitle.current;
      if (editing?.id === asset.id) stopEdit();
      await reload(`${asset.name} deleted`);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Notice id="assets-notice" notice={notice.notice} />
      {totals ? <Summary totals={totals} /> : null}
      {allocation ? <AssetAllocation allocation={allocation} typeLabel={typeLabel} /> : null}
      {afterAllocation}
      <AssetForm
        draft={draft}
        editing={editing}
        invalid={invalid}
        busy={busy}
        nameRef={nameInput}
        onChange={change}
        onClearInvalid={clearInvalid}
        onSubmit={(event) => void submit(event)}
        onCancel={() => {
          if (saving.current) return;
          stopEdit();
          // The cancel button goes away with the edit; keep focus in the form.
          nameInput.current?.focus();
        }}
      />
      <section aria-labelledby="assets-title" className="flex flex-col gap-4">
        <h2 id="assets-title" ref={listTitle} tabIndex={-1} className="outline-none">
          Assets and liabilities
        </h2>
        <AssetList
          assets={assets}
          failed={notice.notice?.kind === 'error'}
          onEdit={startEdit}
          onDelete={remove}
          returnFocusRef={afterDelete}
          onDeleteOpen={() => {
            afterDelete.current = null;
          }}
          onUsagesChanged={load}
        />
      </section>
    </div>
  );
}
