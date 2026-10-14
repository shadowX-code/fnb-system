import {describe,it,expect} from 'vitest';
import {defaultCustomerMapping,mapCustomerRows,initialImportDecisions,selectedImportCount,applyCustomerMapping,customerImportFields,blockDuplicateImportPhones} from '../customerImport.js';
import {parseCsv,safeCsvCell,readTabularFile} from '../../../lib/tabularFile.js';
describe('customer import mapping',()=>{
 it('maps aliases and never maps consent or suppression',()=>{expect(defaultCustomerMapping(['Customer Name','Mobile','Tags','Consent','Suppressed'])).toMatchObject({name:'Customer Name',phone:'Mobile',tags:'Tags',language:'',outlet_id:''})});
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

describe('POS Import V2',()=>{
 it('exposes exactly the thirteen standard fields plus existing optional language',()=>{expect(customerImportFields.filter(f=>f.key!=='language')).toHaveLength(13);expect(customerImportFields.some(f=>/consent|suppress/i.test(f.key))).toBe(false)});
 it('keeps blanks out, preserves POS source context and converts Excel dates precisely',()=>{const rows=mapCustomerRows({format:'xlsx',dateSystem:1900,rows:[{Name:'Fixture',Phone:'0123456789',Birthday:'36526',Email:'',Outlet:''}]},{name:'Name',phone:'Phone',birthday:'Birthday',email:'Email',outlet_id:'Outlet'},[],{source:'POS',snapshotDate:'2026-10-13'});expect(rows[0]).toEqual({name:'Fixture',phone:'0123456789',birthday:'2000-01-01',_source:'POS',_snapshot_date:'2026-10-13'})});
 it('applies saved ignores and flags new and missing source columns',()=>{const r=applyCustomerMapping(['Name','Mobile','Points'],{headers:['Name','Phone','Consent'],mapping:{name:'Name',phone:'Phone',email:''}});expect(r.mapping.phone).toBe('');expect(r.added).toEqual(['Mobile','Points']);expect(r.missing).toEqual(['Phone','Consent'])});
 it('blocks duplicate authorized phones across preview batches',()=>{const rows=[{row:1,classification:'new',values:{phone:'+60123456789'}},{row:251,classification:'review',values:{phone:'+60123456789'}}];expect(blockDuplicateImportPhones(rows).every(r=>r.classification==='conflict')).toBe(true)});
 it('permits 10,000 rows only for callers explicitly requesting that bound',async()=>{const file={name:'POS.csv',size:200000,text:async()=>`Name,Phone\n${'Synthetic,0123456789\n'.repeat(10000)}`};expect((await readTabularFile(file,{maxRows:10000})).rows).toHaveLength(10000);await expect(readTabularFile(file)).rejects.toThrow(/500/)});
});

it('preserves source worksheet positions as non-personal report metadata',()=>{const result=mapCustomerRows({rows:[{__row:18,N:'Synthetic',P:'0123456789'}]},{name:'N',phone:'P'},[],{source:'POS'});expect(result[0].row).toBe(18)});

it('accepts absent and blank names without persisting fallback labels',()=>{expect(mapCustomerRows({rows:[{P:'0123456789'}]},{phone:'P'})).toEqual([{phone:'0123456789'}]);expect(mapCustomerRows({rows:[{P:'0123456789',N:' '} ]},{phone:'P',name:'N'})).toEqual([{phone:'0123456789'}]);});
