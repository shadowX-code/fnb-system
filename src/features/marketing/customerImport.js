export const customerImportFields = [
 {key:'name',label:'Customer name',required:true,aliases:['name','customername','fullname']},
 {key:'phone',label:'Malaysian phone',required:true,aliases:['phone','phonenumber','mobile','whatsapp']},
 {key:'language',label:'Language (EN / ZH / BM)',aliases:['language']},
 {key:'tags',label:'Tags (comma separated)',aliases:['tags','tag']},
 {key:'outlet_id',label:'Brand outlet name or ID',aliases:['outlet','outletname','outletid']},
];
export const importNames={new:'New',unchanged:'Unchanged / Skip',review:'Existing / Review',invalid:'Invalid',conflict:'Conflict',created:'Created',updated:'Updated',skipped:'Skipped'};
export function defaultCustomerMapping(headers) {
 const normalized=h=>h.toLowerCase().replace(/[^a-z0-9]/g,'');
 return Object.fromEntries(customerImportFields.map(f=>[f.key,headers.find(h=>f.aliases.includes(normalized(h)))||'']));
}
export function mapCustomerRows(data,mapping,outlets=[]) {
 if(!mapping.name||!mapping.phone)throw new Error('Map customer name and phone before continuing.');
 const mapped=Object.values(mapping).filter(Boolean);if(new Set(mapped).size!==mapped.length)throw new Error('Map each source column to only one field.');
 return data.rows.map(row=>{
  const result={};for(const f of customerImportFields){if(!mapping[f.key])continue;const value=String(row[mapping[f.key]]??'').trim();
   if(f.key==='tags')result.tags=value.split(',').map(t=>t.trim()).filter(Boolean);
   else if(f.key==='language')result.language=value.toUpperCase()||'EN';
   else if(f.key==='outlet_id'){const matches=outlets.filter(o=>o.id===value||o.name.toLowerCase()===value.toLowerCase());result.outlet_id=!value?'':matches.length===1?matches[0].id:value;}
   else result[f.key]=value;
  }return result;
 });
}
export function initialImportDecisions(rows) {return Object.fromEntries(rows.map(r=>[r.row,{selected:r.classification==='new',snapshot:r.snapshot,fields:[]}]))}
export function selectedImportCount(rows,decisions) {return rows.filter(r=>['new','review'].includes(r.classification)&&decisions[r.row]?.selected&&(r.classification==='new'||decisions[r.row]?.fields?.length)).length}
