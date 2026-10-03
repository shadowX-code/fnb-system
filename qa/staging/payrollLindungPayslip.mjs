// Shared production renderer with real rolled-back Staging authority manifests.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { renderPayslip } from '../../supabase/functions/payroll-payslips/render.js';
import { loadPayslipFonts } from '../../supabase/functions/payroll-payslips/fonts/load.js';
const require = createRequire(process.env.PAYROLL_PDF_MODULE_ROOT || '/private/tmp/feedx-lindung-pdf/package.json');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { manifests } = JSON.parse(await readFile(process.argv[2], 'utf8'));
const api = { PDFDocument, StandardFonts, rgb, fontkit };
for (const [kind, original] of Object.entries(manifests)) {
  const manifest = { ...original, identity: { ...original.identity, employee_name: 'QA ONLY 陈伟明' } };
  const fonts = await loadPayslipFonts(manifest, async path => new Blob([await readFile(new URL(`../../supabase/functions/payroll-payslips/fonts/prepared/${path.split('/').at(-1)}`, import.meta.url))]));
  const labels = [];
  // Capture actual layout labels while retaining the existing Unicode renderer.
  const actualCreate = PDFDocument.create;
  PDFDocument.create = async () => {
    const pdf = await actualCreate.call(PDFDocument);
    const actualAdd = pdf.addPage.bind(pdf);
    pdf.addPage = (...args) => {
      const page = actualAdd(...args), draw = page.drawText.bind(page);
      page.drawText = (text, options) => { labels.push(text); return draw(text, options); };
      return page;
    };
    return pdf;
  };
  let bytes;
  try { bytes = await renderPayslip(manifest, { ...api, unicodeFonts: fonts }); }
  finally { PDFDocument.create = actualCreate; }
  assert.ok(labels.join('').includes('LINDUNG 24 Jam'));
  assert.ok(!labels.join('').includes('LINDUNG Employer'));
  assert.ok(!labels.join('').includes('LINDUNG 24 Jam Employer'));
  assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
  assert.deepEqual(bytes, await renderPayslip(manifest, { ...api, unicodeFonts: fonts }), 'Deterministic PDF retry');
  await writeFile(`/private/tmp/feedx-lindung-${kind}.pdf`, bytes);
}
assert.equal(manifests.draft.statutory.find(line => line.scheme === 'lindung').amount, 24.35);
assert.equal(manifests.final.statutory.find(line => line.scheme === 'lindung').amount, 24.35);
console.log('PASS: actual Staging Draft/Final manifests, separate LINDUNG deduction, no employer line, Unicode and deterministic shared renderer');
