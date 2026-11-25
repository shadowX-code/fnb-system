import { expect, it } from 'vitest';
import { renderPayslip } from './render.js';

it.each([true, false])('renders only meaningful Units / Rate details (draft: %s)', async draft => {
  const drawn = [];
  const page = { drawText: (text, options) => drawn.push({ text, ...options }), drawLine() {} };
  const pdf = {
    setCreationDate() {}, setModificationDate() {}, setTitle() {}, setAuthor() {},
    embedFont: async () => ({ widthOfTextAtSize: text => text.length * 4 }),
    addPage: () => page, getPages: () => [page], getPageCount: () => 1, save() {},
  };
  const manifest = {
    draft, pay_basis: 'monthly', period_start: '2026-09-01', finalized_at: '2026-10-01T00:00:00Z',
    identity: { employer: 'QA Only', employee_name: 'QA Only' },
    earnings: [
      { label: 'Basic Salary', amount: 2000, units: 'Contractual monthly salary' },
      { label: 'Employment Proration', amount: -200, units: 'Partial employment period' },
      { label: 'Hourly Pay', amount: 32, minutes: 240, rate: 8 },
      { label: 'Overtime', amount: 24, minutes: 120, rate: 8, multiplier: 1.5 },
      { label: 'Meal Allowance', amount: 10, units: ' ' },
    ],
    deductions: [], statutory: [{ scheme: 'epf', applicable: true, amount: 200 }],
    gross_earnings: 1866, total_deductions: 200, net_pay: 1666,
  };

  await renderPayslip(manifest, { PDFDocument: { create: async () => pdf }, StandardFonts: {}, rgb: () => null });

  const unitsColumnX = drawn.find(row => row.text === 'UNITS / RATE').x;
  expect(drawn.filter(row => row.x === unitsColumnX).map(row => row.text)).toEqual([
    'UNITS / RATE', 'Partial employment period', '4.00 h x RM 8.00', '2.00 h x RM 8.00 x 1.5',
  ]);
  expect(drawn.map(row => row.text)).toEqual(expect.arrayContaining(['Basic Salary', 'RM 2,000.00', 'EPF Employee', 'RM 200.00']));
});
