import { type ChangeEvent, useEffect, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Label } from './components/ui/label';
import { Notice } from './components/ui/notice';
import {
  CsvError,
  dataRowCount,
  entryCsvPath,
  exportUrl,
  type Field,
  fieldLabel,
  fields,
  type FixedKind,
  guessMapping,
  headerIndex,
  type ImportRow,
  type Mapping,
  maxImportBytes,
  maxImportRows,
  notUtf8,
  parseCsv,
  toImportRows,
} from './entry-csv-parse';
import { type Filters, selectClass } from './entry-filters-state';
import { requestJson } from './lib/api';
import { useNotice } from './lib/use-notice';

type Preview = {
  rows: number;
  valid: number;
  problems: { line: number; message: string }[];
  duplicates: number[];
  /** The rows this preview checked. */
  sent: ImportRow[];
};

/** Problems listed on screen; the rest are counted. */
const shownProblems = 20;

/** Download the filtered entries, and import a CSV file after a preview (#44). */
export function EntryCsv({ filters, onImported }: { filters: Filters; onImported: () => void }) {
  const notice = useNotice();
  const { error: showError, status: showStatus, clear } = notice;
  const [file, setFile] = useState<{ name: string; rows: string[][] }>();
  const [mapping, setMapping] = useState<Mapping>();
  const [fixedKind, setFixedKind] = useState<FixedKind>('expense');
  const [preview, setPreview] = useState<Preview>();
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);

  // Counts changes of the file, the columns, or the kind: an answer to a request sent before a change is dropped,
  // so the preview always describes what is on screen.
  const choice = useRef(0);
  const changed = () => {
    choice.current++;
    setPreview(undefined);
  };

  // Counts chosen files only: an import that ends after another file was chosen must not clear that file,
  // while one that ends after a column change still clears the imported file's form (#200).
  const fileChoice = useRef(0);

  const changeMapping = (next: Mapping) => {
    setMapping(next);
    changed();
  };

  useEffect(() => {
    if (preview) previewHeading.current?.focus();
  }, [preview]);

  const reset = () => {
    setFile(undefined);
    setMapping(undefined);
    changed();
    if (fileInput.current) fileInput.current.value = '';
  };

  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    fileChoice.current++;
    changed();
    const asked = choice.current;
    clear();
    // Each file starts from the defaults: choices made for the previous file do not carry over (#200).
    setSkipDuplicates(true);
    setFixedKind('expense');
    if (!chosen) {
      reset();
      return;
    }
    // Checked before reading: a huge file would be read whole into memory first (#200).
    if (chosen.size > maxImportBytes) {
      reset();
      showError(
        `The file is larger than ${maxImportBytes / 1024 / 1024} MB. Split it and import the parts`,
      );
      return;
    }
    let text: string;
    try {
      text = await chosen.text();
    } catch {
      if (choice.current !== asked) return;
      reset();
      showError('Could not read the file. Choose it again');
      return;
    }
    if (choice.current !== asked) return; // another file was chosen meanwhile
    if (notUtf8(text)) {
      reset();
      showError('This file is not UTF-8. In Excel, save it as "CSV UTF-8" and choose it again');
      return;
    }
    let rows: string[][];
    try {
      rows = parseCsv(text);
    } catch (cause) {
      if (!(cause instanceof CsvError)) throw cause;
      reset();
      showError(`${cause.message}. Fix the file and choose it again`);
      return;
    }
    const count = dataRowCount(rows);
    if (count === 0) {
      reset();
      showError('The file has no rows under its header');
      return;
    }
    if (count > maxImportRows) {
      reset();
      showError(`The file has ${count} rows. Import at most ${maxImportRows} at a time`);
      return;
    }
    setFile({ name: chosen.name, rows });
    setMapping(guessMapping(rows[headerIndex(rows)]));
  };

  const body = () => (file && mapping ? toImportRows(file.rows, mapping, fixedKind) : []);
  const missing = mapping
    ? (['date', 'amount'] as const).filter((field) => mapping[field] < 0)
    : [];

  const check = async () => {
    if (busy || !file || !mapping) return;
    if (missing.length > 0) {
      showError(`Choose the column for ${missing.map((field) => fieldLabel[field]).join(' and ')}`);
      return;
    }
    setBusy(true);
    clear();
    const asked = choice.current;
    const rows = body();
    try {
      const answer = await requestJson<Omit<Preview, 'sent'>>(`${entryCsvPath}/preview`, {
        method: 'POST',
        body: { rows },
      });
      // The import sends the very rows that were checked.
      if (choice.current === asked) setPreview({ ...answer, sent: rows });
    } catch (cause) {
      if (choice.current === asked) showError(cause, 'Could not check the file');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy || !preview || preview.problems.length > 0) return;
    setBusy(true);
    clear();
    const asked = choice.current;
    const importedFile = fileChoice.current;
    try {
      const result = await requestJson<{ imported: number; skipped: number }>(
        `${entryCsvPath}/import`,
        {
          method: 'POST',
          body: { rows: preview.sent, skipDuplicates },
        },
      );
      // A file chosen while this one was importing stays: only the imported file's form is cleared (#200).
      const current = fileChoice.current === importedFile;
      if (current) reset();
      showStatus(
        result.skipped > 0
          ? `Imported ${result.imported} entries and skipped ${result.skipped} likely duplicates`
          : `Imported ${result.imported} entries`,
      );
      onImported();
      if (current) fileInput.current?.focus();
    } catch (cause) {
      // Nothing was saved. Something changed since the preview (e.g. a category was hidden): check again.
      // A preview made meanwhile (another file or other columns) stays.
      if (choice.current === asked) setPreview(undefined);
      showError(cause, 'Could not import the file');
    } finally {
      setBusy(false);
    }
  };

  const duplicates = preview?.duplicates.length ?? 0;
  const importing = preview ? preview.valid - (skipDuplicates ? duplicates : 0) : 0;
  const blocked = busy || !preview || preview.problems.length > 0 || importing === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle asHeading="h3">CSV</CardTitle>
        <CardDescription>
          Download the entries the filters above match, or import entries from a CSV file (UTF-8, at
          most {maxImportRows} rows). Nothing is saved until every row is right.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Notice id="entry-csv-notice" notice={notice.notice} />
        <div>
          <Button asChild variant="outline">
            <a href={exportUrl(filters)} download>
              Download CSV
            </a>
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="entry-csv-file">CSV file to import</Label>
          <input
            ref={fileInput}
            id="entry-csv-file"
            type="file"
            accept=".csv,text/csv"
            className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
            onChange={(event) => void choose(event)}
          />
        </div>
        {file && mapping ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-sm font-medium">
              Columns of {file.name} ({dataRowCount(file.rows)} rows)
            </legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fields.map((field: Field) => (
                <div key={field} className="flex flex-col gap-1">
                  <Label htmlFor={`entry-csv-${field}`}>
                    {fieldLabel[field]}
                    {field === 'date' || field === 'amount' ? '' : ' (optional)'}
                  </Label>
                  <select
                    id={`entry-csv-${field}`}
                    className={selectClass}
                    value={mapping[field]}
                    onChange={(event) =>
                      changeMapping({ ...mapping, [field]: Number(event.target.value) })
                    }
                  >
                    <option value={-1}>
                      {field === 'kind' ? 'None: the same kind for every row' : 'None'}
                    </option>
                    {file.rows[headerIndex(file.rows)].map((name, index) => (
                      <option key={index} value={index}>
                        {name.trim() || `Column ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {mapping.kind < 0 ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="entry-csv-fixed-kind">Kind of every row</Label>
                  <select
                    id="entry-csv-fixed-kind"
                    className={selectClass}
                    value={fixedKind}
                    onChange={(event) => {
                      setFixedKind(event.target.value as FixedKind);
                      changed();
                    }}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                </div>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Kind takes income or expense (수입, 지출 too). An empty category is filled by your
              keyword rules.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                aria-disabled={busy || undefined}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                onClick={() => void check()}
              >
                Check the rows
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </fieldset>
        ) : null}
        {preview ? (
          <section aria-labelledby="entry-csv-preview" className="flex flex-col gap-3">
            <h4
              id="entry-csv-preview"
              ref={previewHeading}
              tabIndex={-1}
              className="font-medium outline-none"
            >
              {preview.problems.length > 0
                ? `${preview.problems.length} of ${preview.rows} rows cannot be imported`
                : `All ${preview.rows} rows can be imported`}
            </h4>
            {preview.problems.length > 0 ? (
              <>
                <ul
                  aria-label="Rows that cannot be imported"
                  className="flex flex-col gap-1 text-sm"
                >
                  {preview.problems.slice(0, shownProblems).map((problem) => (
                    <li key={problem.line}>
                      <span className="font-medium">Row {problem.line}</span>: {problem.message}
                    </li>
                  ))}
                </ul>
                {preview.problems.length > shownProblems ? (
                  <p className="text-sm text-muted-foreground">
                    And {preview.problems.length - shownProblems} more rows.
                  </p>
                ) : null}
                <p className="text-sm">
                  Fix the file or the column choice, then check again. Nothing was saved.
                </p>
              </>
            ) : null}
            {duplicates > 0 ? (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  {duplicates} rows look like entries you already have (same date, kind, amount, and
                  merchant): row {preview.duplicates.slice(0, shownProblems).join(', ')}
                  {duplicates > shownProblems ? ', …' : ''}.
                </p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={skipDuplicates}
                    onChange={(event) => setSkipDuplicates(event.target.checked)}
                  />
                  Skip these rows
                </label>
              </div>
            ) : null}
            {preview.problems.length === 0 ? (
              <div>
                <Button
                  type="button"
                  aria-disabled={blocked || undefined}
                  className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  onClick={() => void save()}
                >
                  {importing > 0 ? `Import ${importing} entries` : 'Nothing to import'}
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
