# #401 Remove explanatory, example and motivational text

- Issue: [#401](https://github.com/sirloinbh/money-ledger/issues/401) (tracking: sirloinbh/project-standards#1216; rule: design-system `docs/guidelines.md`, "Screen text rule")

## Changes — 2026-11-29

Search used: `description=`, `e\.g\.`, `placeholder=`, `aria-describedby`, `-hint` ids and `text-muted-foreground` paragraphs in `frontend/src` (not tests, not the UI kit).

Removed:

- Page descriptions: Settings, Dashboard, Ledger, Goals, Mock trading, Asset portfolio, Reports (`Page` description is now optional). The dashboard card descriptions "Practice money, not part of your net worth" and "Real assets minus liabilities". Dated descriptions (day, month, report period) stay as status text.
- Every input placeholder (the `e.g. ...` examples, `YYYY-MM`, `YYYY-MM-DD`, `1 to 31`, `Merchant or note`, `Name or code; ticker for US`).
- Hint lines under fields and their `aria-describedby`: manual price, budget ("Applies from ..."), entry category, fixed cost day and start month, mock account amount, mock order, security link, security search.
- Intro and note paragraphs: backup restore note, budget overspending note, categories hiding note, fixed costs intro, mock account reset note, all-in buy note, mock holdings definition (the "could not be calculated" status stays).

Kept: labels, errors, empty-state text, status text, dialog consequence text, the trade-managed quantity note.

Tests: the five tests that asserted the removed text no longer do.
