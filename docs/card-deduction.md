# Year-end card deduction: the rules the estimate uses (#296)

Checked on 2026-11-26 against public guides (not the tax office itself; the numbers below are the same in every one). **The screen shows an estimate. Check the figures with the National Tax Service before filing.**

## Rules used

| Rule                             | Value                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| Threshold (최저사용금액)         | 25% of the total salary. Spending up to it earns nothing.                                           |
| Credit card rate                 | 15% of spending past the threshold                                                                  |
| Debit card and cash receipt rate | 30%                                                                                                 |
| Order that fills the threshold   | Credit card spending first, then debit card and cash (the cheaper rate is used up first)            |
| Base limit by total salary       | up to ₩70,000,000: ₩3,000,000; up to ₩120,000,000: ₩2,500,000; above: ₩2,000,000                    |
| Rounding                         | Each rate rounds down to a whole won; all arithmetic is integer (bigint) in `estimateCardDeduction` |

The constants live in one place, `cardRules` in `backend/src/ledger/card-deduction.ts`. If a rule changes, only that table and its test change.

## Not modeled (the estimate can be off by these)

- Higher rates and extra limits for traditional markets, public transport, and culture/books/sports.
- The extra limit for children under 18 that applies from the 2026 tax year (+₩0.5 million per child, up to +₩1 million; half of that above ₩70 million).
- Spending that does not count for the deduction (tax, insurance, tuition, rent, car purchase, and similar), and spending on a family member's card.
- A proposal to cut the public transport limit from 2027 is not final and is not used.

## Sources

- <https://card.hyundaicard.com/magazine/2025-%EC%8B%A0%EC%9A%A9%EC%B9%B4%EB%93%9C-%EC%97%B0%EB%A7%90%EC%A0%95%EC%82%B0-%EC%86%8C%EB%93%9D%EA%B3%B5%EC%A0%9C-%EB%86%93%EC%B9%98%EB%A9%B4-%ED%9B%84%ED%9A%8C%ED%95%A0-tip.hdc>
- <https://www.taxcut.kr/year-end-tax/guide>
- <https://www.make2t.kr/2026/11/2026-credit-card-income-deduction-calculation.html>
- <https://magazine.lboas.com/%EC%8B%A0%EC%9A%A9%EC%B9%B4%EB%93%9C-%EC%86%8C%EB%93%9D%EA%B3%B5%EC%A0%9C-%EA%B3%84%EC%82%B0/>

The legal basis is the Restriction of Special Taxation Act article 126-2 (조세특례제한법 제126조의2). A follow-up check against the law text itself is worth doing before relying on the limits.
