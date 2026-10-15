import { describe, expect, it } from 'vitest';
import { addDays, today } from './dates.js';

describe('§4.6 business dates', () => {
  it('today is the date in the org time zone, wherever the server runs', () => {
    // 17:30 UTC on Oct 14 is already Oct 15 in Ho Chi Minh City (UTC+7)…
    expect(today('Asia/Ho_Chi_Minh', 0, new Date('2026-10-14T17:30:00Z'))).toBe(
      '2026-10-15',
    );
    // …and 03:00 UTC on Oct 14 is still Oct 13 in Los Angeles (UTC−7 in October).
    expect(
      today('America/Los_Angeles', 0, new Date('2026-10-14T03:00:00Z')),
    ).toBe('2026-10-13');
  });

  it('the demo clock moves today on by whole days', () => {
    expect(today('Asia/Ho_Chi_Minh', 3, new Date('2026-10-14T17:30:00Z'))).toBe(
      '2026-10-18',
    );
  });

  it('adds calendar days across months, years and Feb 29', () => {
    expect(addDays('2026-10-26', -14)).toBe('2026-10-12');
    expect(addDays('2026-10-26', 7)).toBe('2026-11-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });
});
