# Receipt photo files follow their rows (#374)

## Problem

- A card import that removed an entry (a fully cancelled payment) deleted the row with a plain `DELETE`. The photo rows went by the foreign key, but only the entry router removed the stored files, so the photos stayed in the private bucket with nothing pointing to them.
- Deleting a photo removed the row first and then awaited the storage delete. If storage failed, the request answered 500 although the photo was already gone, and the file was orphaned.
- The 5-photo limit was a count followed by an insert, so uploads at the same time could all pass it.

## Change

- `photos.ts` has two shared helpers: `photoKeysOf` (the stored keys of some entries, read before they are deleted) and `removeStoredFiles` (delete the files, log a failure, never throw). The entry delete middleware and the photo delete route use them.
- The card import router takes the storage. It collects the keys of each removed entry in the transaction and removes the files after the commit.
- Upload: the file is stored, then one transaction locks the entry row (`FOR UPDATE`), counts the photos and inserts. A refusal removes the stored file. The cheap count before the upload stays, so a full entry does not even upload.

## Tests

`backend/test/photo-cleanup.integration.test.ts`: the import removal leaves only the unrelated entry's file; a failing storage delete still answers 204; four parallel uploads into a slot-and-a-half leave exactly 5 photos and no extra file.
