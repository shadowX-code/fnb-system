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
const {unified_manifests:manifests}=JSON.parse(await readFile(process.argv[2],'utf8'));
assert.equal(manifests.length,3);
for (const [index,manifest] of manifests.entries()) {
 assert.deepEqual(manifest.draft.earnings,manifest.final.earnings);
 assert.equal(manifest.final.earnings.reduce((sum,x)=>sum+Number(x.amount),0),Number(manifest.final.gross_earnings));
 assert.equal(manifest.final.earnings.filter(x=>x.label==='Public Holiday Allowance').some(x=>Number(x.amount)===(index===0?100:40)),true);
 assert.ok(manifest.final.earnings.every(x=>!('source' in x) && !('calculation_details' in x)));
for(const kind of ['draft','final']) {
 const document=manifest[kind];
 const unicodeFonts=await loadPayslipFonts(document,async path=>new Blob([await readFile(new URL(`../../supabase/functions/payroll-payslips/fonts/prepared/${path.split('/').at(-1)}`,import.meta.url))]));
 const bytes=await renderPayslip(document,{PDFDocument,StandardFonts,rgb,fontkit,unicodeFonts});
 assert.deepEqual(bytes,await renderPayslip(document,{PDFDocument,StandardFonts,rgb,fontkit,unicodeFonts}));
 assert.equal((await PDFDocument.load(bytes)).getPageCount(),1);
 await writeFile(`/private/tmp/payroll-ph-unified-${index}-${kind}.pdf`,bytes);
}
}
console.log('PASS: three actual canonical company calculations; Draft/Final renderer parity, exact Gross, Unicode and separate PH overtime evidence.');
