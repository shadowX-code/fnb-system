import {describe,it,expect} from 'vitest';
import {defaultCustomerMapping,mapCustomerRows,initialImportDecisions,selectedImportCount} from '../customerImport.js';
import {parseCsv,safeCsvCell,readTabularFile} from '../../../lib/tabularFile.js';
describe('customer import mapping',()=>{
 it('maps aliases and never maps consent or suppression',()=>{expect(defaultCustomerMapping(['Customer Name','Mobile','Tags','Consent','Suppressed'])).toEqual({name:'Customer Name',phone:'Mobile',tags:'Tags',language:'',outlet_id:''})});
 it('preserves unmapped fields and resolves only an unambiguous brand outlet',()=>{const data=parseCsv('Name,Phone,Outlet,Tags\nA,0123456789,Ipoh,"VIP, Regular"');expect(mapCustomerRows(data,{name:'Name',phone:'Phone',outlet_id:'Outlet',tags:'Tags'},[{id:'outlet',name:'Ipoh'}])).toEqual([{name:'A',phone:'0123456789',outlet_id:'outlet',tags:['VIP','Regular']}])});
 it('requires name and phone mapping and rejects source-column reuse',()=>{expect(()=>mapCustomerRows({rows:[]},{name:'Name'})).toThrow(/phone/);expect(()=>mapCustomerRows({rows:[]},{name:'N',phone:'N'})).toThrow(/only one/) });
 it('never selects existing, invalid or conflict rows automatically',()=>{const rows=['new','unchanged','review','invalid','conflict'].map((classification,i)=>({row:i+1,classification,snapshot:'snapshot'}));const decisions=initialImportDecisions(rows);expect(selectedImportCount(rows,decisions)).toBe(1);expect(decisions[3]).toEqual({selected:false,snapshot:'snapshot',fields:[]});decisions[3]={selected:true,fields:['name']};expect(selectedImportCount(rows,decisions)).toBe(2)});
});
describe('shared tabular file boundary',()=>{
 it('supports BOM, quoted multiline values, commas and escaped quotes',()=>{const parsed=parseCsv('\uFEFFName,Phone,Note\r\n"A, B",0123456789,"Line 1\nLine ""2"""');expect(parsed.rows[0].Name).toBe('A, B');expect(parsed.rows[0].Note).toBe('Line 1\nLine "2"')});
 it('rejects broken quoting, duplicate headers and misaligned rows',()=>{expect(()=>parseCsv('Name,Phone\n"A,01')).toThrow(/Unclosed/);expect(()=>parseCsv('Name,name\nA,A')).toThrow(/unique/);expect(()=>parseCsv('N,P\nA,B,C')).toThrow(/more values/)});
 it('does not pollute object prototypes and exports spreadsheet-safe cells',()=>{const r=parseCsv('__proto__,Phone\nvalue,0123456789').rows[0];expect(Object.getPrototypeOf(r)).toBeNull();expect(safeCsvCell('=HYPERLINK("evil")')).toContain("'=HYPERLINK");expect(safeCsvCell('+60123456789')).toBe('"\'+60123456789"')});
 it('rejects unsupported files and bounds customer row count',async()=>{await expect(readTabularFile({name:'file.exe',size:2})).rejects.toThrow(/CSV or XLSX/);await expect(readTabularFile({name:'file.csv',size:2,text:async()=>`Name,Phone\n${'A,0123456789\n'.repeat(501)}`})).rejects.toThrow(/500/)});
});
