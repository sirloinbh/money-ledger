# Investment income and tax rules used by the estimate (#295)

Checked on 2026-11-26. The estimate on the Asset portfolio page is a guide, not a tax return. Tax law can change; confirm on Hometax (hometax.go.kr) or with a tax accountant before filing.

## Overseas stock capital gains (what the estimate computes)

- The gains and losses of one calendar year (by settlement date) on overseas stocks are added up. A loss on one stock offsets a gain on another, across countries. Domestic stocks are not mixed in.
- A basic deduction of ₩2,500,000 a year comes off the net gain. The rest is taxed at 22% (20% income tax + 2% local income tax), whatever the size.
- The return for a year is filed and paid in May of the next year.
- A net loss, or a gain under the deduction, owes nothing. The estimate shows ₩0 and does not carry a loss to another year (the law does not either).

Sources (news and guides found by search on 2026-11-26; no primary Hometax page was opened):

- [THE FINANCE: capital gains tax season](https://v.daum.net/v/20250409182039083)
- [Seoul Shinmun: capital gains tax guide for overseas stock investors](https://www.seoul.co.kr/news/newsView.php?id=20260525500093)
- [KB Think: overseas stock capital gains tax](https://kbthink.com/main/asset-management/wealth-manage-tip/kbthink-original/202409/foreignstocktax.html)

## Dividends and interest (shown, not taxed by the estimate)

- Financial income (dividends + interest) of up to ₩20,000,000 a year is taxed at 15.4% (14% + 1.4% local) withheld at the source, and nothing more is filed. Above ₩20,000,000 the whole amount is added to other income and taxed at the progressive comprehensive rates. The ₩20,000,000 line is measured before tax.
- The screen therefore shows the year's total, the tax already withheld as entered, and a notice when the total passes ₩20,000,000. It does not compute the comprehensive tax.
- The search did not confirm how a dividend from an overseas stock is withheld at home or how the foreign tax credit works. Record the withheld tax you actually see on the statement; do not rely on the screen for those.

Sources:

- [PwC Samil, One Point Tax 11](https://www.pwc.com/kr/ko/insights/issue-brief/one-point-tax-11.html)
- [KB Think: comprehensive taxation of financial income](https://kbthink.com/tax/guide/tax-financial-income.html)

## Cost basis (user decision, 2026-11-26)

The realized gain of a sale uses the **moving average** cost basis, the method already used for asset trades (#46, migration 013): a sale takes `round(cost × quantity sold ÷ quantity held)` of the won cost. Fees and taxes on a buy go into the cost; those on a sale come off the gain. A dollar sale is converted at the rate entered on each trade, so exchange-rate moves count.

Known difference: a broker's overseas capital gains statement may use another method (for example first-in-first-out), so its number can differ from this estimate. The user chose the moving average; the screen says so.

## Not covered

Mock accounts (#52 and later) are practice, not taxable, and are left out. Gains on assets whose quantity is entered by hand (no trades) have no cost basis and are left out. Foreign tax credit, the comprehensive income tax and the national health insurance effect are not computed.
