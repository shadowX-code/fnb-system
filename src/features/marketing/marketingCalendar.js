const pad = value => String(value).padStart(2, '0');
export function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function localInput(date, timezone) {
  const p = zonedParts(date, timezone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Resolve the supplied wall clock in the declared timezone, independent of browser timezone.
// DST gaps and overlaps require explicit correction rather than silent time shifts.
export function scheduleInstant(local, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Choose a valid publishing date and time.');
  const nominal = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(nominal)) throw new Error('Choose a valid publishing date and time.');
  let candidate = nominal;
  for (let i = 0; i < 4; i++) {
    const observed = Date.parse(`${localInput(new Date(candidate), timezone)}:00Z`);
    candidate += nominal - observed;
  }
  if (localInput(new Date(candidate), timezone) !== local) throw new Error('This time does not exist in the selected timezone.');
  // Cover ordinary and half-hour DST transitions.
  if ([-120,-90,-60,-30,30,60,90,120].some(minutes => localInput(new Date(candidate + minutes * 60000), timezone) === local)) throw new Error('This time is ambiguous in the selected timezone. Choose a time outside the clock change.');
  return new Date(candidate).toISOString();
}
export function calendarRange(anchor, mode, timezone) {
  const [year, month, day] = anchor.split('-').map(Number);
  const current = new Date(Date.UTC(year, month - 1, day));
  const start = mode === 'month' ? new Date(Date.UTC(year, month - 1, 1)) : new Date(current.getTime() - ((current.getUTCDay() + 6) % 7) * 86400000);
  const end = mode === 'month' ? new Date(Date.UTC(year, month, 1)) : new Date(start.getTime() + 7 * 86400000);
  const label = date => `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
  const days = Array.from({ length: Math.round((end-start)/86400000) }, (_, index) => label(new Date(start.getTime()+index*86400000)));
  return { from: scheduleInstant(`${label(start)}T00:00`, timezone), to: scheduleInstant(`${label(end)}T00:00`, timezone), days };
}
