import { z } from 'zod/v4';

import { date } from '../ledger/entries.js';
import { HttpError } from '../standard/http.js';

// Request schemas of the asset API (#45, #46, #47, #63, #64). Formats follow AGENTS.project.md "Quantity,
// foreign currency, and exchange rate" (#35): won amounts are JSON numbers, quantities and USD amounts are
// decimal strings. The routes are in assets.ts, the valuation query in asset-valuation.ts.

const maxWon = 1_000_000_000_000_000;

export const assetTypes = [
  'stock',
  'real_estate',
  'cash',
  'debt',
  'depreciable',
  'prepaid',
  'other',
] as const;

// Up to 12 integer and 8 fractional digits: numeric(20,8).
const quantityPattern = /^\d{1,12}(\.\d{1,8})?$/;
// Up to 16 integer and 4 fractional digits: numeric(20,4).
const foreignPattern = /^\d{1,16}(\.\d{1,4})?$/;

const wonAmount = (label: string) => {
  return z
    .number({ error: `Enter the ${label} as a number` })
    .int(`Enter the ${label} as a whole number of won`)
    .min(0, `The ${label} must be ₩0 or more`)
    .max(maxWon, `Enter a ${label} of ₩1 quadrillion or less`);
};

const depreciation = z.object(
  {
    purchasePriceKrw: wonAmount('purchase price'),
    purchasedOn: date,
    usefulLifeMonths: z
      .number({ error: 'Enter the useful life in months' })
      .int('Enter the useful life as a whole number of months')
      .min(1, 'The useful life must be at least 1 month')
      .max(1200, 'Enter a useful life of 1200 months (100 years) or less'),
    // Decision (2026-11-02): no salvage value unless one is entered.
    salvageValueKrw: wonAmount('salvage value').default(0),
  },
  { error: 'Send the depreciation info as an object' },
);

const prepaid = z.object(
  {
    kind: z.enum(['amount', 'period'], {
      error: 'Choose a prepaid kind: voucher or pass',
    }),
    amountKrw: wonAmount('amount paid'),
    // A period pass only; a stored-value one has no start.
    startsOn: date.nullable().default(null),
    // Required for a period pass, optional for a stored-value one (decision 2026-11-08).
    expiresOn: date.nullable().default(null),
  },
  { error: 'Send the prepaid info as an object' },
);

const manualPrice = z.object(
  {
    price: z
      .string({ error: 'Send the current price as a decimal string' })
      .regex(foreignPattern, {
        error: 'Enter the current price with up to 16 integer and 4 decimal digits',
        abort: true,
      })
      .refine((value) => /[1-9]/.test(value), 'The current price must be above 0'),
    pricedOn: date,
  },
  { error: 'Send the manual current price as an object' },
);

export const usageBody = z.object(
  {
    usedOn: date,
    amountKrw: z
      .number({ error: 'Enter the amount used as a number' })
      .int('Enter the amount used as a whole number of won')
      .min(1, 'The amount used must be at least ₩1')
      .max(maxWon, 'Enter an amount used of ₩1 quadrillion or less'),
    memo: z
      .string({ error: 'The note must be text' })
      .trim()
      .max(100, 'The note must be 100 characters or fewer')
      .default(''),
  },
  { error: 'The request body must be a JSON object' },
);

// #46 Types that can have buy and sell records (decision 2026-11-08); #47 also the ones a hand price fits.
export const tradeableTypes: readonly string[] = ['stock', 'other'];

export const assetBody = z
  .object(
    {
      name: z
        .string({ error: 'Enter an asset name' })
        .trim()
        .normalize('NFC')
        .min(1, 'Enter an asset name')
        .max(50, 'Enter an asset name of 50 characters or fewer'),
      type: z.enum(assetTypes, { error: 'Choose an asset type' }),
      currency: z.enum(['KRW', 'USD'], { error: 'Choose KRW or USD as the currency' }),
      quantity: z
        .string({ error: 'Send the quantity as a decimal string' })
        .regex(quantityPattern, {
          error: 'Enter the quantity with up to 12 integer and 8 decimal digits',
          abort: true,
        })
        .refine((value) => /[1-9]/.test(value), 'The quantity must be above 0')
        .nullable()
        .default(null),
      valueKrw: z
        .number({ error: 'Enter the valuation as a number' })
        .int('Enter the valuation in won as a whole number')
        .min(0, 'The valuation must be 0 or more')
        // ₩1 quadrillion: far above any household asset, and low enough that thousands of them still total
        // to a safe integer. Totals that still overflow are reported as null rather than failing the list.
        .max(maxWon, 'Enter a valuation of ₩1 quadrillion or less')
        .nullable()
        .default(null),
      valueForeign: z
        .string({ error: 'Send the foreign-currency valuation as a decimal string' })
        .regex(
          foreignPattern,
          'Enter the foreign-currency valuation with up to 16 integer and 4 decimal digits',
        )
        .nullable()
        .default(null),
      memo: z
        .string({ error: 'The note must be text' })
        .trim()
        .max(200, 'The note must be 200 characters or fewer')
        .default(''),
      depreciation: depreciation.nullable().default(null),
      prepaid: prepaid.nullable().default(null),
      securityId: z
        .number({ error: 'Send the security ID as a number' })
        .int('Check the security ID')
        .positive('Check the security ID')
        .max(Number.MAX_SAFE_INTEGER, 'Check the security ID')
        .nullable()
        .default(null),
      manualPrice: manualPrice.nullable().default(null),
    },
    { error: 'The request body must be a JSON object' },
  )
  .superRefine((body, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (body.currency === 'KRW' && body.valueForeign !== null) {
      issue('Enter the valuation of a won asset in won');
    }
    if (body.currency === 'USD' && body.valueKrw !== null) {
      issue('Enter the valuation of a dollar asset in dollars');
    }
    if (body.type !== 'depreciable' && body.depreciation !== null) {
      issue('Depreciation info can only go on a depreciable asset');
    }
    if (body.type !== 'prepaid' && body.prepaid !== null) {
      issue('Prepaid info can only go on a prepaid asset');
    }
    if (body.type !== 'stock' && body.securityId !== null) {
      issue('A security can only be linked to a stock asset');
    }
    // A linked asset is quantity × close only: a value typed before (maybe in another currency) is never used.
    if (body.securityId !== null && (body.valueKrw !== null || body.valueForeign !== null)) {
      issue(
        'An asset linked to a security is valued at the received close, so do not enter a valuation',
      );
    }
    if (body.manualPrice !== null) {
      if (!tradeableTypes.includes(body.type)) {
        issue('A current price can only be entered for a stock or other (crypto, etc.) asset');
      } else if (body.securityId !== null) {
        issue(
          'An asset linked to a security is valued at the received close, so do not enter a current price',
        );
      } else if (body.currency === 'KRW' && /\.\d*[1-9]/.test(body.manualPrice.price)) {
        issue('Enter a won current price as a whole number of won');
      }
    }
    if (body.type === 'prepaid') {
      if (body.prepaid === null) {
        issue('A prepaid asset needs a voucher or pass kind and the amount paid');
        return;
      }
      if (body.currency !== 'KRW') issue('A prepaid asset must be in won');
      if (body.quantity !== null || body.valueKrw !== null || body.valueForeign !== null) {
        issue('A prepaid asset is valued from the amount paid, not from a valuation');
      }
      const { kind, startsOn, expiresOn } = body.prepaid;
      if (kind === 'amount' && startsOn !== null) {
        issue('A voucher has no start date');
      }
      if (kind === 'period') {
        if (startsOn === null || expiresOn === null) {
          issue('A pass needs a start date and an expiry date');
        } else if (startsOn > expiresOn) {
          issue('The expiry date must be on or after the start date');
        }
      }
      return;
    }
    if (body.type === 'depreciable') {
      if (body.depreciation === null) {
        issue('A depreciable asset needs a purchase price, purchase date, and useful life');
        return;
      }
      if (body.currency !== 'KRW') issue('A depreciable asset must be in won');
      if (body.quantity !== null || body.valueKrw !== null || body.valueForeign !== null) {
        issue('A depreciable asset is valued from the purchase price, not from a valuation');
      }
      const { purchasePriceKrw, salvageValueKrw } = body.depreciation;
      // A negative price already has its own message.
      if (purchasePriceKrw >= 0 && salvageValueKrw > purchasePriceKrw) {
        issue('The salvage value cannot be more than the purchase price');
      }
      return;
    }
    if (body.type === 'debt' && body.quantity !== null) {
      issue('A liability cannot have a quantity');
    }
  });

export const listQuery = z.object({ asOf: date.optional() });

/**
 * A plain asset needs a quantity or a value. Checked outside the schema because an asset whose quantity
 * comes from trades may hold nothing (everything sold) and still be edited.
 */
export function requireQuantityOrValue(body: z.infer<typeof assetBody>) {
  if (body.type === 'depreciable' || body.type === 'prepaid') return;
  if (body.quantity === null && body.securityId !== null) {
    throw new HttpError(400, 'Enter a quantity to link a security');
  }
  if (body.quantity === null && body.valueKrw === null && body.valueForeign === null) {
    throw new HttpError(400, 'Enter a valuation for an asset without a quantity');
  }
  if (body.quantity === null && body.manualPrice !== null) {
    throw new HttpError(400, 'Enter a quantity to set a current price');
  }
}
