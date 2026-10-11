import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {parseXlsx} from '../tabularFile.js';
async function file(name){const data=await readFile(new URL('./fixtures/'+name,import.meta.url));return {arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}}
describe('OOXML customer workbook parsing',()=>{
 it('reads inline strings and retains the exact worksheet row number',async()=>{const parsed=await parseXlsx(await file('customers.xlsx'));expect(parsed.headers).toEqual(['Name','Phone']);expect(parsed.rows[0]).toMatchObject({Name:'Disposable QA Customer',Phone:'0123456789',__row:3})});
 it('rejects formulas before customer import review',async()=>{await expect(parseXlsx(await file('customers-formula.xlsx'))).rejects.toThrow(/formulas/)});
 it('rejects a corrupt archive without attempting an import',async()=>{await expect(parseXlsx({arrayBuffer:async()=>new ArrayBuffer(10)})).rejects.toThrow(/workbook/)});
});
