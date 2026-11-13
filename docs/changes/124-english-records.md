# Translate past records in docs to English (#124)

Issue: [#124](https://github.com/sirloinbh/money-ledger/issues/124), tracked by [project-standards#487](https://github.com/sirloinbh/project-standards/issues/487).

## Purpose

The change records and daily logs under `docs/changes/` and `docs/daily/` are English. There are no ADRs in this repository (`docs/adr/` does not exist).

## Changes

- Translated all 29 Korean records in `docs/changes/` (including `README.md` and `bootstrap.md`) and the 3 files in `docs/daily/`.
- Headings, command output, file paths, identifiers, issue and PR numbers, dates, and numbers are unchanged.
- This record is new and written in English.

## Korean kept on purpose

Quoted Korean text is kept as it was, with an English gloss in parentheses where the meaning is not obvious. This covers UI text, API error messages, category and merchant names used as test data, and migration or test names that appear in the records.

## Verification

- `prettier --check` on the changed files: pass.
- Hangul search over `docs/changes/` and `docs/daily/`: only the quoted strings described above remain.
