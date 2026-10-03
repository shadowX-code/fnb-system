// Render server-composed Draft/Final fixtures, never calculate Payroll in JS.
// Usage: node payrollEarningGroups.render.mjs <CLI JSON output> <pdf runtime package.json>
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { renderPayslip } from '../../supabase/functions/payroll-payslips/render.js';
import { loadPayslipFonts } from '../../supabase/functions/payroll-payslips/fonts/load.js';
const require=createRequire(process.argv[3]);
const { PDFDocument,StandardFonts,rgb }=require('pdf-lib');
const fontkit=require('@pdf-lib/fontkit');
const {manifest}=JSON.parse(await readFile(process.argv[2],'utf8')).rows[0];
assert.deepEqual(manifest.draft.earnings,manifest.final.earnings);
assert.equal(manifest.draft.earnings.length,6);
assert.equal(manifest.final.earnings.find(x=>x.label==='Public Holiday Allowance').amount,72);
assert.ok(manifest.final.earnings.every(x=>!('source' in x) && !('calculation_details' in x)));
for(const kind of ['draft','final']) {
 const document=manifest[kind];
 const unicodeFonts=await loadPayslipFonts(document,async path=>new Blob([await readFile(new URL(`../../supabase/functions/payroll-payslips/fonts/prepared/${path.split('/').at(-1)}`,import.meta.url))]));
 const bytes=await renderPayslip(document,{PDFDocument,StandardFonts,rgb,fontkit,unicodeFonts});
 assert.deepEqual(bytes,await renderPayslip(document,{PDFDocument,StandardFonts,rgb,fontkit,unicodeFonts}));
 assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
 await writeFile(`/private/tmp/payroll-earning-groups-${kind}.pdf`,bytes);
}
console.log('PASS: actual Draft/Final Unicode renderer, six compatible aggregate groups, PH label, exact server amounts and bounded renderer input.');
