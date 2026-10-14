import { describe,it,expect } from 'vitest';
import { scheduleInstant,calendarRange,localInput } from '../marketingCalendar.js';
describe('Marketing timezone scheduling',()=>{
  it('converts Malaysia wall time to an exact UTC instant independently of browser timezone',()=>{
    expect(scheduleInstant('2026-10-15T09:30','Asia/Kuala_Lumpur')).toBe('2026-10-15T01:30:00.000Z');
    expect(localInput(new Date('2026-10-15T01:30:00Z'),'Asia/Kuala_Lumpur')).toBe('2026-10-15T09:30');
  });
  it('rejects daylight-saving gaps and overlaps',()=>{
    expect(()=>scheduleInstant('2026-03-08T02:30','America/New_York')).toThrow('does not exist');
    expect(()=>scheduleInstant('2026-11-01T01:30','America/New_York')).toThrow('ambiguous');
    expect(()=>scheduleInstant('2026-10-04T02:15','Australia/Lord_Howe')).toThrow('does not exist');
  });
  it('bounds calendar ranges across month/year boundaries and uses a Monday week',()=>{
    const month=calendarRange('2026-12-15','month','Asia/Kuala_Lumpur');
    expect(month.days).toHaveLength(31);expect(month.from).toBe('2026-11-30T16:00:00.000Z');expect(month.to).toBe('2026-12-31T16:00:00.000Z');
    const week=calendarRange('2027-01-01','week','Asia/Kuala_Lumpur');
    expect(week.days[0]).toBe('2026-12-28');expect(week.days.at(-1)).toBe('2027-01-03');
  });
});
