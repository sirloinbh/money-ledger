import { type ChangeEvent, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import { selectClass } from './entry-filters-state';
import { countOf, formatWon } from './format';
import { requestForm, type RequestOptions } from './lib/api';
import { useNotice } from './lib/use-notice';

// #57 Import a Woori Card usage-history file (.xls). The server reads the file, so the browser only sends its bytes.

/**
 * Sends the file's bytes as they are (the server reads the file itself). The shared request helper (a centrally
 * managed file) only has a multipart variant, which passes its body to fetch unchanged, so a Blob goes through it
 * with an explicit content type.
 */
const requestBytes = <T,>(path: string, file: Blob, init: RequestOptions = {}) =>
  requestForm<T>(path, file as unknown as FormData, {
    ...init,
    headers: { 'content-type': 'application/octet-stream', ...init.headers },
  });

const cardImportPath = '/api/ledger/entries/card-import';
const maxBytes = 5_000_000;
const shownRows = 30;

type Kind = 'domestic' | 'foreign';
type Row = {
  line: number;
  date: string;
  merchant: string;
  amount: number;
  memo: string;
  action: 'new' | 'update' | 'remove' | 'unchanged' | 'skipped';
  candidate: boolean;
};
type Preview = {
  rows: Row[];
  authorizations: number;
  problems: { line: number; message: string }[];
};
type Result = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  skipped: number;
};

const actionText: Record<Row['action'], string> = {
  new: 'Add',
  update: 'Update',
  remove: 'Remove (cancelled)',
  unchanged: 'Already imported',
  skipped: 'Cancelled, not added',
};

/** Upload, preview and save a card usage file as expenses. */
export function CardImport({ onImported }: { onImported: () => void }) {
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  const [file, setFile] = useState<File>();
  const [kind, setKind] = useState<Kind>('domestic');
  const [preview, setPreview] = useState<Preview>();
  const [skipCandidates, setSkipCandidates] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // Counts changes of the file or the kind: an answer to an older request is dropped.
  const choice = useRef(0);
  const changed = () => {
    choice.current++;
    setPreview(undefined);
  };
  const query = (skip = skipCandidates) => `kind=${kind}&skipCandidates=${skip}`;

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    changed();
    clear();
    if (!chosen) return setFile(undefined);
    if (chosen.size > maxBytes) {
      setFile(undefined);
      showError('The file is larger than 5 MB');
      return;
    }
    setFile(chosen);
  };

  const check = async () => {
    if (busy || !file) return;
    setBusy(true);
    clear();
    const asked = choice.current;
    try {
      const answer = await requestBytes<Preview>(`${cardImportPath}/preview?${query()}`, file);
      if (choice.current === asked) setPreview(answer);
    } catch (cause) {
      if (choice.current === asked) showError(cause, 'Could not read the file');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy || !file || !preview) return;
    setBusy(true);
    clear();
    try {
      const result = await requestBytes<Result>(`${cardImportPath}/import?${query()}`, file);
      changed();
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      const parts = [
        `added ${countOf(result.added, 'entry', 'entries')}`,
        ...(result.updated > 0 ? [`updated ${result.updated}`] : []),
        ...(result.removed > 0 ? [`removed ${result.removed} cancelled`] : []),
        ...(result.skipped > 0 ? [`left out ${result.skipped}`] : []),
      ];
      showStatus(`Imported: ${parts.join(', ')}`);
      onImported();
    } catch (cause) {
      showError(cause, 'Could not import the file');
    } finally {
      setBusy(false);
    }
  };

  const adding =
    preview?.rows.filter((r) => r.action === 'new' && !(skipCandidates && r.candidate)).length ?? 0;
  const changing =
    preview?.rows.filter((r) => r.action === 'update' || r.action === 'remove').length ?? 0;
  const candidates = preview?.rows.filter((r) => r.action === 'new' && r.candidate).length ?? 0;
  const problems = preview?.problems ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h3">Card usage file</CardTitle>
        <CardDescription>
          Import the Woori Card usage history (.xls from the card website) as expenses. Importing
          the same or a newer file again updates the same entries. The file and the full card number
          are not stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Notice id="card-import-notice" notice={notice.notice} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="card-import-kind">Which download</Label>
            <select
              id="card-import-kind"
              className={selectClass}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Kind);
                changed();
              }}
            >
              <option value="domestic">Domestic use (국내 이용내역)</option>
              <option value="foreign">Foreign use (해외 승인내용)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="card-import-file">Usage history file</Label>
            <input
              ref={fileInput}
              id="card-import-file"
              type="file"
              accept=".xls,application/vnd.ms-excel"
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
              onChange={choose}
            />
          </div>
        </div>
        <div>
          <Button
            type="button"
            aria-disabled={busy || !file || undefined}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={() => void check()}
          >
            Check the file
          </Button>
        </div>
        {preview ? (
          <section aria-labelledby="card-import-preview" className="flex flex-col gap-3">
            <h4 id="card-import-preview" className="font-medium">
              {problems.length > 0
                ? `${countOf(problems.length, 'row')} cannot be read`
                : `${countOf(adding, 'payment')} to add, ${changing} to change`}
            </h4>
            {problems.length > 0 ? (
              <ul aria-label="Rows that cannot be read" className="flex flex-col gap-1 text-sm">
                {problems.slice(0, shownRows).map((problem) => (
                  <li key={problem.line}>
                    <span className="font-medium">Row {problem.line}</span>: {problem.message}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                {preview.authorizations > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {countOf(preview.authorizations, 'card-check authorization')} with no amount
                    left out.
                  </p>
                ) : null}
                {candidates > 0 ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={skipCandidates}
                      onChange={(event) => setSkipCandidates(event.target.checked)}
                    />
                    Leave out {countOf(candidates, 'payment')} that match an entry you typed (same
                    day and amount)
                  </label>
                ) : null}
                <ul aria-label="Payments in the file" className="flex flex-col gap-1 text-sm">
                  {preview.rows.slice(0, shownRows).map((row) => (
                    <li key={row.line} className="flex flex-wrap gap-x-3">
                      <span>{row.date}</span>
                      <span className="font-medium">{row.merchant || '(no name)'}</span>
                      <span>{formatWon(row.amount)}</span>
                      <span className="text-muted-foreground">
                        {actionText[row.action]}
                        {row.candidate ? ', maybe a duplicate' : ''}
                        {row.memo ? `, ${row.memo}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {preview.rows.length > shownRows ? (
                  <p className="text-sm text-muted-foreground">
                    And {countOf(preview.rows.length - shownRows, 'more payment')}.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    aria-disabled={busy || adding + changing === 0 || undefined}
                    className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                    onClick={() => void save()}
                  >
                    Import
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
