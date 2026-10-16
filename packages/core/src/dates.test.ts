import { describe, expect, it } from 'vitest';
import { addDays, businessMoment, today } from './dates.js';

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

  it('BR-D05 a moment moves on by the days the demo clock was ahead when it happened', () => {
    const history = [
      { at: new Date('2026-10-16T02:00:00Z'), offsetDays: 3 },
      { at: new Date('2026-10-16T05:00:00Z'), offsetDays: 8 },
    ];
    const at = (moment: string) =>
      businessMoment(new Date(moment), history).toISOString();
    // Before the first advance, or with none: as it happened.
    expect(at('2026-10-16T01:59:59.999Z')).toBe('2026-10-16T01:59:59.999Z');
    expect(
      businessMoment(new Date('2026-10-16T09:00:00Z'), []).toISOString(),
    ).toBe('2026-10-16T09:00:00.000Z');
    // From an advance on, its own millisecond included: the tick runs right after it.
    expect(at('2026-10-16T02:00:00.000Z')).toBe('2026-10-19T02:00:00.000Z');
    expect(at('2026-10-16T04:59:59.999Z')).toBe('2026-10-19T04:59:59.999Z');
    expect(at('2026-10-16T05:00:00.000Z')).toBe('2026-10-24T05:00:00.000Z');
    // Still to come, as an invitation's expiry: by the clock as it is now.
    expect(at('2026-10-19T05:00:00.000Z')).toBe('2026-10-27T05:00:00.000Z');
  });
});
