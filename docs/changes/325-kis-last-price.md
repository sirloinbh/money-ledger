# Read the last traded price from KIS without the order book (#325)

`quote()` needs the order book and reports an empty one as "market closed", which is normal after 15:30. The 19:10 KakaoTalk summary (#313) and the per-minute day trade check (#309) only need the price.

| File                             | Change                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/prices/kis.ts`      | `KisSource.lastPrice(symbol)`: one call to the current-price endpoint, returns `{ symbol, price, readAt }`; same error mapping as `quote` |
| `backend/src/prices/kis-fake.ts` | The fake answers for every symbol, also the always-closed `999999`                                                                        |
| `backend/test/kis.test.ts`       | One call only, works without an order book, error mapping without leaking the secret, an answer without a price, the fake                 |
| `docs/price-source.md`           | One line in "Live prices (KIS)"                                                                                                           |

`readAt` is when the app read the price. The current-price answer may carry its own trade time, but that field is not confirmed against a real account (#304), so it is not used.

`lastPrice` is required on `KisSource`, so any other implementation of the type (for example a scripted source in a test) must add it.
