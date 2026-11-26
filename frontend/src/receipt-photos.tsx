import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from './components/ui/button';
import { ConfirmDialog } from './components/ui/confirm-dialog';
import { Notice } from './components/ui/notice';
import { requestForm, requestJson, type RequestOptions } from './lib/api';
import { useNotice } from './lib/use-notice';

// #300 Receipt photos of one entry: a "Receipts" button under the row opens the photos, with attach and delete. The
// server removes location and other metadata from every photo and keeps the files in a private bucket; they are shown
// through the API only (never a public address).

const maxBytes = 8 * 1024 * 1024;
const maxPhotos = 5;
const accepted = ['image/jpeg', 'image/png'];

type Photo = { id: number; contentType: string; byteSize: number };
type Listing = { photos: Photo[]; enabled: boolean };

/** Sends the file's bytes as they are; the shared helper only has a multipart variant, which passes a Blob through. */
const requestBytes = <T,>(path: string, file: Blob, init: RequestOptions = {}) =>
  requestForm<T>(path, file as unknown as FormData, {
    ...init,
    headers: { 'content-type': file.type, ...init.headers },
  });

export function ReceiptPhotos({ entryId, label }: { entryId: number; label: string }) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<Listing | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { notice, status, error, clear } = useNotice();
  const input = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const base = `/api/ledger/entries/${entryId}/photos`;

  const load = useCallback(async () => {
    try {
      setListing(await requestJson<Listing>(base));
    } catch (cause) {
      error(cause, 'Could not load the photos');
    }
  }, [base, error]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const attach = async (file: File | undefined) => {
    if (!file) return;
    clear();
    if (!accepted.includes(file.type)) return error('Choose a JPEG or PNG photo');
    if (file.size > maxBytes) return error('The photo is larger than 8 MB');
    setBusy(true);
    try {
      await requestBytes(base, file);
      status('Photo attached');
      await load();
    } catch (cause) {
      error(cause, 'Could not attach the photo');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (photo: Photo) => {
    clear();
    try {
      await requestJson(`${base}/${photo.id}`, { method: 'DELETE' });
      status('Photo deleted');
      await load();
    } catch (cause) {
      error(cause, 'Could not delete the photo');
      throw cause;
    }
  };

  const photos = listing?.photos ?? [];
  return (
    <div className="flex w-full flex-col gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Receipts of ${label}`}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide receipts' : 'Receipts'}
      </Button>
      <div id={panelId} hidden={!open} className="flex flex-col gap-2">
        {open && listing && !listing.enabled ? (
          <p className="text-body-sm text-muted-foreground">
            Photo storage is not set up on this server.
          </p>
        ) : null}
        {open && listing?.enabled && photos.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No receipt photos yet.</p>
        ) : null}
        {photos.length > 0 ? (
          <ul aria-label={`Receipt photos of ${label}`} className="flex flex-wrap gap-3">
            {photos.map((photo, index) => (
              <li key={photo.id} className="flex flex-col gap-1">
                <a href={`${base}/${photo.id}`} target="_blank" rel="noreferrer">
                  <img
                    src={`${base}/${photo.id}`}
                    alt={`Receipt ${index + 1}`}
                    loading="lazy"
                    className="h-28 w-28 rounded-lg border object-cover"
                  />
                </a>
                <ConfirmDialog
                  title="Delete this photo?"
                  description="Deleting it cannot be undone."
                  onConfirm={() => remove(photo)}
                  trigger={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Delete receipt photo ${index + 1} of ${label}`}
                    >
                      Delete
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
        {open && listing?.enabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-body-sm" htmlFor={`${panelId}-file`}>
              Attach a photo
            </label>
            <input
              ref={input}
              id={`${panelId}-file`}
              type="file"
              accept="image/jpeg,image/png"
              disabled={busy || photos.length >= maxPhotos}
              onChange={(event) => void attach(event.target.files?.[0])}
              className="text-body-sm"
            />
            {photos.length >= maxPhotos ? (
              <span className="text-body-sm text-muted-foreground">
                An entry holds up to {maxPhotos} photos.
              </span>
            ) : null}
          </div>
        ) : null}
        <Notice notice={notice} />
      </div>
    </div>
  );
}
