import { expect, it } from 'vitest';
import { openDelivery, payslipFilename, pdfDisposition, sealDelivery } from './delivery.js';

const manifest = { period_start: '2026-09-01', identity: { employee_name: ' 陈/美:琪\r\n Zoë* ' } };

it('uses the approved period and names without filename separators or header injection', () => {
  const draft = payslipFilename(manifest, true);
  const final = payslipFilename(manifest, false);
  expect(draft).toBe('Payslip_2026-09_陈 美 琪 Zoë_DRAFT.pdf');
  expect(final).toBe('Payslip_2026-09_陈 美 琪 Zoë.pdf');
  for (const [name, download] of [[draft, false], [final, true]]) {
    const header = pdfDisposition(name, download);
    expect(header.startsWith(download ? 'attachment;' : 'inline;')).toBe(true);
    expect(header).toMatch(/^[\x20-\x7e]*$/);
    expect(decodeURIComponent(header.split("filename*=UTF-8''")[1])).toBe(name);
  }
  expect(new TextEncoder().encode(payslipFilename({ ...manifest, identity: { employee_name: '陈'.repeat(150) } }, true)).length).toBeLessThan(256);
  expect(() => payslipFilename({ ...manifest, period_start: '2026-99-01' })).toThrow();
});

it('seals the authorized delivery scope and rejects expired or altered URLs', async () => {
  const scope = {
    kind: 'draft', authorization: 'Bearer synthetic-data', filename: payslipFilename(manifest, true),
    args: { p_run_id: 'run', p_employee_id: 'employee' }, manifestHash: 'snapshot',
  };
  const ticket = await sealDelivery(scope, 'qa-only-key', 1000);
  expect(ticket).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(ticket).not.toContain('synthetic-data');
  expect(await openDelivery(ticket, 'qa-only-key', 60999)).toMatchObject(scope);
  expect(await openDelivery(ticket, 'qa-only-key', 61000)).toBeNull();
  expect(await openDelivery(ticket, 'other-key', 1001)).toBeNull();
  expect(await openDelivery((ticket[0] === 'A' ? 'B' : 'A') + ticket.slice(1), 'qa-only-key', 1001)).toBeNull();
});
