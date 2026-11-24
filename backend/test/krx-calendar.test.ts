import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCalendar } from '../src/prices/kis.js';
import { ruleClosures } from '../src/prices/krx-calendar.js';

// #321 Parsing and the computed KRX-only closures; no database.

// The shape of a KIS 국내휴장일조회 answer (CTCA0903R): one row per calendar day with opnd_yn (market open). The
// field names come from the KIS API portal's description; a real answer has not been checked (waiting on #304).
const recorded = {
  rt_cd: '0',
  msg_cd: 'KIOK0460',
  output: [
    {
      bass_dt: '20261224',
      wday_dvsn_cd: '05',
      bzdy_yn: 'Y',
      tr_day_yn: 'Y',
      opnd_yn: 'Y',
      sttl_day_yn: 'Y',
    },
    {
      bass_dt: '20261225',
      wday_dvsn_cd: '06',
      bzdy_yn: 'N',
      tr_day_yn: 'N',
      opnd_yn: 'N',
      sttl_day_yn: 'N',
    },
    {
      bass_dt: '20261226',
      wday_dvsn_cd: '07',
      bzdy_yn: 'N',
      tr_day_yn: 'N',
      opnd_yn: 'N',
      sttl_day_yn: 'N',
    },
  ],
};

test('parses the days of a recorded answer', () => {
  assert.deepEqual(parseCalendar(recorded), [
    { date: '2026-12-24', open: true },
    { date: '2026-12-25', open: false },
    { date: '2026-12-26', open: false },
  ]);
});

test('skips rows it cannot read and refuses an answer without rows', () => {
  assert.deepEqual(
    parseCalendar({
      output: [
        { bass_dt: 'x', opnd_yn: 'Y' },
        { bass_dt: '20261224', opnd_yn: '?' },
        null,
        { bass_dt: '20261224', opnd_yn: 'Y' },
      ],
    }),
    [{ date: '2026-12-24', open: true }],
  );
  assert.throws(() => parseCalendar({ rt_cd: '0' }), /not in the expected format/);
  assert.throws(() => parseCalendar(null), /not in the expected format/);
});

test('Labour Day and the last weekday of the year are KRX-only closures', () => {
  // 2026: May 1 is a Friday; Dec 31 is a Thursday.
  assert.deepEqual(ruleClosures(2026), [
    { date: '2026-05-01', name: 'Labour Day' },
    { date: '2026-12-31', name: 'Year-end market closure' },
  ]);
  // 2027: May 1 is a Saturday (no weekday closure); Dec 31 is a Friday.
  assert.deepEqual(ruleClosures(2027), [{ date: '2027-12-31', name: 'Year-end market closure' }]);
  // 2028: Dec 31 is a Sunday, so the closing day is Friday Dec 29.
  assert.equal(ruleClosures(2028).at(-1)?.date, '2028-12-29');
});
