# Receipt photos on entries (#300)

Part of epic #286 (ledger reconciliation and entry detail). Issue: <https://github.com/sirloinbh/money-ledger/issues/300>.

## Purpose

A receipt shows what a payment was for, but there was nowhere to keep it. An entry can now hold up to 5 receipt photos that are viewed and deleted from the entry list.

## Decisions (user, 2026-11-26, issue comment)

- Storage: a private S3 bucket in `sirloinbh/shared-aws-infrastructure` (the Terraform PR is lane-3's; its apply is the user's step).
- The full backup (#298) includes the photos.

## Changes

| Area     | Change                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database | `057_entry_photos.sql`: table `ledger_entry_photos` (entry, storage key, JPEG/PNG type, size). Deleting an entry deletes its rows. The number is rechecked at the final sync with main.                                                                                                                                                           |
| Storage  | `storage.ts`: the `ObjectStorage` interface (put, get, delete) with an in-memory fake. `storage-s3.ts`: the S3 client (`@aws-sdk/client-s3`, installed with `--ignore-scripts`), bucket name from `PHOTO_BUCKET`. Unset: photos are off.                                                                                                          |
| Backend  | `ledger/photos.ts`: `GET/POST /api/ledger/entries/:entryId/photos`, `GET/DELETE .../photos/:photoId`. `ledger/photo-strip.ts` removes metadata. Deleting an entry also removes its files (a hook before the entry's DELETE route).                                                                                                                |
| Backup   | `ledger_entry_photos` is an entered table. The backup file gets a `photos` map (storage key to base64 bytes). Export refuses (not a silent partial file) when photos exist but storage is off or a file is missing. Restore writes the files before the commit and removes them again if the restore fails. The restore body limit is now 400 MB. |
| Frontend | `receipt-photos.tsx`: a "Receipts" button on each entry row opens the photos with attach, thumbnails and delete.                                                                                                                                                                                                                                  |
| OpenAPI  | The four routes.                                                                                                                                                                                                                                                                                                                                  |

## Behavior

- Only JPEG and PNG are accepted (checked by the file's first bytes, not the name or header), up to 8 MB, 5 per entry.
- **Metadata removal:** the file is rewritten without EXIF (GPS, device, time), XMP, comments and PNG text/time chunks; the pixels are not re-encoded. For a JPEG the orientation is the one EXIF fact kept, in a tiny segment holding nothing else, so a sideways phone photo still shows upright.
- Photos are served only through the API behind the sign-in with `Cache-Control: private, no-store`; there is no public or signed URL.
- A photo is looked up by entry and photo id together, so a guessed id under another entry is a 404.
- Backup decision: the photos are embedded in the backup JSON (base64) instead of turning the backup into a tar archive. This keeps one file and the existing restore path (empty database only); the cost is size (about 4/3 of the photos). Restore checks each embedded file is a JPEG or PNG matching its row.

## User steps

- Apply lane-3's Terraform PR in shared-aws-infrastructure (the bucket and the access key's permissions).
- Put `PHOTO_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` in the server `.env`.

## Verification

- `backend/test/photo-strip.test.ts` (5 tests): EXIF/XMP/comment removal with orientation kept, upright JPEG with no EXIF, PNG text/EXIF/time removal, refusal of non-images and truncated files, the storage fake.
- `backend/test/photos.integration.test.ts` on the lane test DB (port 15492): attach/list/view/delete with the stored file free of GPS, wrong entry 404, non-image/empty/oversize/unknown entry refusals, sixth photo 409, backup round trip (files in the backup, entry delete removes files, restore brings them back), 503 without storage.
- `frontend/src/receipt-photos.test.tsx` (4 tests).
- Browser (Playwright, lane-2 ports 3192/5292, lane test DB, in-memory photo storage): at 390x844 and 1440x900 the "Receipts" button opened the panel, attaching a PNG through the file input showed its thumbnail (the image loaded, 200 px natural width, 112 px shown), no horizontal overflow at either size, buttons 32 px tall.
- `openapi.test.ts` and `docs/openapi.json` updated for the four routes; the photo router is listed in the mounts of the route test.
- `npm run check`: see the PR.

## Limits

- The real S3 client is not exercised by tests (no bucket yet); the interface and fake are. The first real upload happens after the user's apply.
- No photo editing or re-ordering; delete and attach again.
- HEIC is not accepted; phones usually convert to JPEG when a file is chosen in a browser.
