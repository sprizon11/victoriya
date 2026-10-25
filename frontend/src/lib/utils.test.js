import { plannedFromOrder, localDate } from './utils';

describe('plannedFromOrder (must match backend/lotmath.py)', () => {
  test.each([
    [110, 5, 116], [100, 5, 105], [109, 5, 114], [111, 5, 117], [130, 5, 137],
    [123, 5, 129], [0, 5, 0], [109, 4.5, 114], [50, 0, 50], [7, 50, 11],
  ])('%i at %f%% plans %i', (order, pct, expected) => {
    expect(plannedFromOrder(order, pct)).toBe(expected);
  });

  test('blank or junk input plans zero rather than NaN', () => {
    expect(plannedFromOrder('', 5)).toBe(0);
    expect(plannedFromOrder('abc', 5)).toBe(0);
  });

  test('text inputs from the form work', () => {
    expect(plannedFromOrder('110', '5')).toBe(116);
  });

  test('the overall total is the sum of rounded cells', () => {
    const cells = [109, 109, 109].map(n => plannedFromOrder(n, 5));
    expect(cells.reduce((a, b) => a + b, 0)).toBe(342);
  });
});

describe('localDate', () => {
  test('uses the local calendar day, not UTC', () => {
    // 00:30 local on 26 Oct is still 25 Oct in UTC for any zone ahead of UTC
    const d = new Date(2026, 9, 26, 0, 30);
    expect(localDate(d)).toBe('2026-10-26');
  });
  test('pads month and day', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

import { weekStartOf, addDays, dmy } from './utils';

describe('pay weeks run Saturday to Friday', () => {
  test.each([
    ['2026-10-24', '2026-10-24'],   // a Saturday is its own start
    ['2026-10-25', '2026-10-24'],   // Sunday
    ['2026-10-28', '2026-10-24'],   // Wednesday
    ['2026-10-30', '2026-10-24'],   // Friday is the last day
    ['2026-10-31', '2026-10-31'],   // next Saturday starts the next week
    ['2026-01-01', '2025-12-27'],   // crosses the year
  ])('%s belongs to the week of %s', (day, start) => {
    expect(weekStartOf(day)).toBe(start);
  });
  test('addDays and dmy', () => {
    expect(addDays('2026-10-24', 7)).toBe('2026-10-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dmy('2026-10-24')).toBe('24/10/2026');
  });
});
