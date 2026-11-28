// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/backup-section/
import { useState } from 'react';

import { cn } from '../../lib/utils';
import { downloadBlob } from '../file-field/download-blob';
import { FileField } from '../file-field/file-field';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/confirm-dialog';

type Status = { kind: 'ok' | 'error'; text: string };

// The export and import part of a settings page. Export builds the data with `onExport` and downloads it as
// `fileName`. Import picks a file, asks first (the file replaces what is stored, so the dialog says so), then hands the
// file to `onImport`. The result shows under the buttons: `role="status"` for success, `role="alert"` for a failure,
// and the live regions stay in the page so a screen reader announces the text when it appears.
// All texts are English defaults that a screen can override.
function BackupSection({
  title = 'Backup',
  description,
  fileName,
  mimeType = 'application/json',
  accept = 'application/json,.json',
  onExport,
  onImport,
  exportLabel = 'Export data',
  importLabel = 'Import data',
  confirmTitle = 'Replace your data?',
  confirmDescription = 'Importing a backup replaces the data stored now. This cannot be undone.',
  confirmLabel = 'Import',
  exportedText = 'Backup downloaded.',
  importedText = 'Backup imported.',
  className,
}: {
  title?: string;
  description?: React.ReactNode;
  fileName: string;
  mimeType?: string;
  accept?: string;
  onExport: () => BlobPart | Promise<BlobPart>;
  onImport: (file: File) => void | Promise<unknown>;
  exportLabel?: string;
  importLabel?: string;
  confirmTitle?: string;
  confirmDescription?: React.ReactNode;
  confirmLabel?: string;
  exportedText?: string;
  importedText?: string;
  className?: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const message = (error: unknown) =>
    error instanceof Error && error.message ? error.message : 'Something went wrong.';

  const exportData = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      downloadBlob(fileName, mimeType, await onExport());
      setStatus({ kind: 'ok', text: exportedText });
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    } finally {
      setBusy(false);
    }
  };

  const importFile = async () => {
    const chosen = file;
    if (!chosen) return;
    setStatus(null);
    try {
      await onImport(chosen);
      setStatus({ kind: 'ok', text: importedText });
    } catch (error) {
      setStatus({ kind: 'error', text: message(error) });
    }
  };

  return (
    <section
      data-slot="backup-section"
      aria-labelledby="backup-section-title"
      className={cn('flex flex-col gap-3', className)}
    >
      <h2 id="backup-section-title">{title}</h2>
      {description ? <p className="text-body-sm text-muted-foreground">{description}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-disabled={busy || undefined}
          onClick={() => void exportData()}
        >
          {exportLabel}
        </Button>
        <FileField accept={accept} onFiles={(files) => setFile(files[0] ?? null)}>
          {importLabel}
        </FileField>
      </div>
      <p role="status" className="text-body-sm text-muted-foreground">
        {status?.kind === 'ok' ? status.text : ''}
      </p>
      <p role="alert" className="text-body-sm font-semibold text-destructive">
        {status?.kind === 'error' ? status.text : ''}
      </p>
      <ConfirmDialog
        open={file !== null}
        onOpenChange={(open) => {
          if (!open) setFile(null);
        }}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        onConfirm={importFile}
      />
    </section>
  );
}

export { BackupSection };
