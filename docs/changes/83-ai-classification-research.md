# #83 Research: classifying spending the keyword rules miss

Compared ways to suggest a category for entries no keyword rule (#60) matches, and recorded the user's decision.

## What changed

- `docs/ai-classification.md`: the comparison and the decision.
  - Options compared: own history, Claude Haiku 5.5, OpenAI gpt-5-nano, Gemini 2.5 Flash-Lite, and a local Ollama model. For each: cost for about 300 items a month, training use, retention, and limits.
  - What would be sent (merchant name and category names only) and how consent would work.
  - The conditions for adding AI later.
- `docs/next-steps/README.md`, `docs/daily/2026-11-16.md`: #71 merged, #83 decided, #154 next.

## Decision (user, 2026-11-16)

History first, AI later. Recorded on #83. The follow-up is #154, "Suggest categories from past classifications of the same merchant" (P3, under epic #90).

## Sources

The prices and data policies were read from the providers' pages on 2026-11-16; the links are in the doc. Local model speed and accuracy, licenses, Korea data residency, and the PIPA reading were not checked against a source, and the doc says so.

## Verification (2026-11-16)

- Docs only. Prettier formatted the changed files, and the relative links were checked by hand: `../changes/…` from `docs/next-steps/`, and the anchor `#if-ai-is-added-later`.
- `npm run check` passed (frontend 358 / 2 skipped; backend 188 / 20 DB tests skipped, none relevant to a docs change).
