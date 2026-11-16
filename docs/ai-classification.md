# Classifying spending the keyword rules miss (#83)

#60 classifies an entry when a keyword rule matches its merchant (`database/migrations/006_ledger_classification.sql`). Entries no rule matches stay uncategorized. This page compares ways to suggest a category for them, and records the decision.

## Decision (user, 2026-11-16)

**History first, AI later.**

- Build now: suggest a category from the user's own past classifications of the same or a similar merchant. Nothing leaves the machine. Built in #154 ([record](changes/154-merchant-suggestions.md)).
- Hosted AI is not built now. It may be revisited later as an optional, off-by-default fallback, under the limits in [If AI is added later](#if-ai-is-added-later).

## Comparison

Volume (assumed, not measured): about 300 classifications a month, roughly 45k input and 3k output tokens. With the category list in each prompt, real use may be 2–3 times that, which is still under $0.05 a month.

| Option                                        | Cost a month                                 | Used for training                     | Retention                                                                       | Notes                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Own history (exact, normalized, then similar) | $0                                           | n/a                                   | Stays in this DB                                                                | Improves as entries are confirmed. Cannot suggest for a merchant never classified before.                                                |
| Claude Haiku 5.5 API                          | about $0.006 ($0.10 in / $0.50 out per MTok) | No, by default for the commercial API | Deleted within 30 days; zero retention only by agreement                        | API key in `.env`. A US-only processing option costs 1.1×. No Korea region found.                                                        |
| OpenAI gpt-5-nano API                         | about $0.0035 ($0.05 / $0.40)                | No, unless opted in                   | Abuse-monitoring logs up to 30 days; zero retention needs sales approval        | Reasoning tokens may raise the output cost. Korea data residency not checked.                                                            |
| Gemini 2.5 Flash-Lite, paid tier              | about $0.006 ($0.10 / $0.40)                 | No, on the paid tier                  | Logged "for a limited period" (length not stated); may be stored in any country | **The free tier is unsuitable**: content is used to improve products, people may read it, and the terms say not to submit personal data. |
| Local model (Ollama, 3–8B)                    | $0 plus electricity                          | Nothing leaves the PC                 | None                                                                            | Needs about 3–6 GB of memory. Without a GPU, roughly 2–10 s an item. Weaker on Korean long-tail names (estimate, not measured).          |

Accuracy: no published benchmark was found for Korean merchant names to categories. Well-known brands (스타벅스, GS25) should be easy for any model. Personal-name merchants, abbreviations, payment-gateway prefixes (`NICE_`, `KCP*`), and marketplaces such as 쿠팡 are hard for every option, so any suggestion must be confirmed by the user.

## What would be sent, and consent

- Only the merchant name and the category names. Never the amount, the date, the memo, or an account.
- A merchant name with no amount, date, or identifier is weak personal information. This is one person's own data used for personal purposes, which the Korean Personal Information Protection Act (PIPA) generally does not target. This is not legal advice and was not checked against a Korean source. Check with PIPC or law.go.kr before the app has other users.
- Merchant names can still reveal sensitive facts, such as a clinic's name.

## If AI is added later

- Off by default, switched on in settings by the user (that is the consent), with a list of what is sent.
- A server-side call with the key in `.env`. The browser never sees the key.
- Claude Haiku or OpenAI gpt-5-nano on paid API terms. Not the Gemini free tier.
- Only for entries that neither the rules nor the history classified. The result is a suggestion the user confirms, and a confirmed result feeds the history.
- A way to keep chosen merchants (for example medical ones) out of the calls.

## Sources

Prices and data policies were read on 2026-11-16:

- https://platform.claude.com/docs/en/about-claude/pricing
- https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
- https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
- https://developers.openai.com/api/docs/pricing
- https://developers.openai.com/api/docs/guides/your-data
- https://aistudio.google.com/docs/pricing
- https://aistudio.google.com/docs/terms

Not checked against a source: OpenAI and Google data residency for Korea, Anthropic zero-retention eligibility, local model speed and accuracy, local model licenses (EXAONE's license is non-commercial; Qwen and Gemma are the safer picks), and the PIPA reading.
