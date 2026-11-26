# #360 Translate the remaining Korean screen text to English

- Issue: https://github.com/sirloinbh/money-ledger/issues/360
- Branch: feat/360-english-screen-text

## Findings

A grep for Hangul outside tests and docs found:

- Screen text, changed: the card file type options (`Domestic use`, `Foreign use`), the CSV hint, and the memos the card import writes (`Installment N months`, `Installment`, `Foreign`). Memos already saved keep their text (user data).
- Kept on purpose: Korean words the parsers read from Korean card statements and bank CSV files (input), the Kakao chatbot command words (the bot is a chat, not a screen; its replies are English), the Korean fixed-cost category presets (they must match the user's own category names), fake test data and code comments.

## Verification

`npm run check`.
