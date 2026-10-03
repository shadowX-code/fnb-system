import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {parseOfficialPages} from '../../../../../supabase/functions/payroll-holiday-updates/parser.js';
const fixture = name => JSON.parse(readFileSync(`${process.cwd()}/qa/fixtures/holidays/${name}.text-items.json`,'utf8'));
const hash='415023261014e30880b0fbb7a40c47a9655605183ef976204489d760fed769a3';
it('extracts all 49 official rows with explicit jurisdictions and references, rather than guessing nationwide applicability',()=>{
 const {rows}=parseOfficialPages(fixture('hka-2026'),2026,hash);
 expect(rows).toHaveLength(101);
 expect(new Set(rows.map(r=>r.source_locator)).size).toBe(49);
 expect(rows.find(r=>r.date==='2026-03-04')).toMatchObject({name:'Hari Ulang Tahun Pertabalan Sultan Terengganu',state_code:'MY-11'});
 expect(rows.find(r=>r.date==='2026-06-01' && r.scope==='national')).toMatchObject({name:'Hari Keputeraan Rasmi Seri Paduka Baginda Yang di-Pertuan Agong',kind:'gazetted',classification_review:true,suggested_kind:'required'});
 expect(rows.filter(r=>r.name==='Hari Deepavali')).toHaveLength(15);
 expect(rows.some(r=>r.name==='Hari Deepavali' && r.state_code==='MY-13')).toBe(false);
 expect(rows.filter(r=>r.name==='Hari Raya Qurban (Hari Kedua)').map(r=>r.state_code).sort()).toEqual(['MY-02','MY-03','MY-09','MY-11']);
 expect(rows.every(r=>r.source_locator)).toBe(true);
 expect(rows.some(r=>r.uncertainty?.includes('weekday disagree'))).toBe(false);
 expect(rows.find(r=>r.name==='Hari Raya Puasa').uncertainty).toMatch(/subject to change/);
});
it('extracts the rotated Gazette and corroborates the annual dates/jurisdictions',()=>{
 const a=parseOfficialPages(fixture('hka-2026'),2026,hash).rows;
 const b=parseOfficialPages(fixture('gn-2026'),2026,'gazette-text-headings').rows;
 const identity=r=>[r.date,r.state_code,r.name.replace(/[’']/g,'')].join('|');
 expect(b.map(identity).sort()).toEqual(a.map(identity).sort());
});
it('keeps conditional Section 8 alternatives blocked for explicit evidence review',()=>{
 const {rows,metadata}=parseOfficialPages(fixture('pub-111-2026'),2026,'supplement');
 expect(metadata.document_role).toBe('supplement');
 expect(rows).toHaveLength(26);
 expect(new Set(rows.map(r=>r.date))).toEqual(new Set(['2026-03-20','2026-03-23']));
 expect(rows.every(r=>r.uncertainty && r.kind==='special' && !['MY-12','MY-13','MY-15'].includes(r.state_code))).toBe(true);
});
it('fails closed for unverified image headings, wrong year, unknown layouts and shifted state markers',()=>{
 expect(()=>parseOfficialPages(fixture('hka-2026'),2026,'changed-source')).toThrow(/column headings/);
 expect(()=>parseOfficialPages(fixture('hka-2026'),2027,hash)).toThrow(/year/);
 expect(()=>parseOfficialPages([{page:1,items:[]}],2026,'empty')).toThrow(/Unsupported/);
 const pages=fixture('hka-2026');pages[3].items.find(i=>i.text==='√').x=900;
 expect(()=>parseOfficialPages(pages,2026,hash)).toThrow(/jurisdiction marker/);
});
