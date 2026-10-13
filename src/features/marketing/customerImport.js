export const CUSTOMER_IMPORT_LIMIT = 10000;
export const customerImportFields = [
 {key:'name',label:'Name',required:true,aliases:['name','customername','fullname','membername']},
 {key:'phone',label:'Phone',required:true,aliases:['phone','phonenumber','mobile','mobilenumber','contactnumber','whatsapp','telephone']},
 {key:'email',label:'Email',aliases:['email','emailaddress']},
 {key:'gender',label:'Gender',aliases:['gender','sex']},
 {key:'birthday',label:'Birthday',aliases:['birthday','birthdate','dateofbirth','dob']},
 {key:'total_visit',label:'Total Visit',aliases:['totalvisit','totalvisits','visits','visitcount']},
 {key:'avg_spent',label:'Avg Spent',aliases:['avgspent','averagespent','averagespend','avgspend']},
 {key:'total_spent',label:'Total Spent',aliases:['totalspent','totalspend','lifetimevalue']},
 {key:'last_visit',label:'Last Visit',aliases:['lastvisit','lastvisitdate']},
 {key:'member_since',label:'Member Since',aliases:['membersince','membershipdate','joindate','joineddate']},
 {key:'tags',label:'Tags',aliases:['tags','tag']},
 {key:'brand',label:'Brand',aliases:['brand','brandname']},
 {key:'outlet_id',label:'Outlet',aliases:['outlet','outletname','outletid','branch','branchname']},
 // Existing imports retain language support; it is not an additional template column.
 {key:'language',label:'Language (optional)',aliases:['language']},
];
export const importNames={new:'New',unchanged:'Unchanged',review:'Updated / Review',invalid:'Needs Review',conflict:'Needs Review',created:'New',updated:'Updated',skipped:'Skipped'};
export function defaultCustomerMapping(headers) {
 const normalized=h=>h.toLowerCase().replace(/[^a-z0-9]/g,'');
 return Object.fromEntries(customerImportFields.map(f=>[f.key,headers.find(h=>f.aliases.includes(normalized(h)))||'']));
}
export function applyCustomerMapping(headers,saved) {
 const automatic=defaultCustomerMapping(headers);
 if(!saved)return {mapping:automatic,added:[],missing:[]};
 const missing=saved.headers.filter(h=>!headers.includes(h)),added=headers.filter(h=>!saved.headers.includes(h));
 const mapping={...automatic};
 for(const f of customerImportFields){if(Object.hasOwn(saved.mapping,f.key))mapping[f.key]=headers.includes(saved.mapping[f.key])?saved.mapping[f.key]:'';}
 return {mapping,added,missing};
}
function excelDate(value,system) {
 if(!/^\d+(\.\d+)?$/.test(value))return value;
 const serial=Number(value);if(serial<1||serial>80000||serial===60&&system!==1904)return value;
 const base=system===1904?Date.UTC(1904,0,1):Date.UTC(1899,11,31);
 return new Date(base+(Math.floor(serial)-(system!==1904&&serial>60?1:0))*86400000).toISOString().slice(0,10);
}
export function mapCustomerRows(data,mapping,outlets=[],context={}) {
 if(!mapping.name||!mapping.phone)throw new Error('Map customer name and phone before continuing.');
 const mapped=Object.values(mapping).filter(Boolean);if(new Set(mapped).size!==mapped.length)throw new Error('Map each source column to only one field.');
 return data.rows.map(row=>{
  const result={};for(const f of customerImportFields){if(!mapping[f.key])continue;let value=String(row[mapping[f.key]]??'').trim();if(!value&&!f.required)continue;
   if(data.format==='xlsx'&&['birthday','last_visit','member_since'].includes(f.key))value=excelDate(value,data.dateSystem);
   if(f.key==='tags')result.tags=value.split(/[,;]/).map(t=>t.trim()).filter(Boolean);
   else if(f.key==='language')result.language=value.toUpperCase();
   else if(f.key==='outlet_id'){const matches=outlets.filter(o=>o.id===value||o.name.toLowerCase()===value.toLowerCase());result.outlet_id=matches.length===1?matches[0].id:value;}
   else result[f.key]=value;
  }
  if(context.source){result._source=context.source;if(row.__row)result.row=row.__row;}
  if(context.snapshotDate)result._snapshot_date=context.snapshotDate;
  return result;
 });
}
export function initialImportDecisions(rows) {return Object.fromEntries(rows.map(r=>[r.row,{selected:r.classification==='new',snapshot:r.snapshot,fields:[]}]))}
export function selectedImportCount(rows,decisions) {return rows.filter(r=>['new','review'].includes(r.classification)&&decisions[r.row]?.selected&&(r.classification==='new'||decisions[r.row]?.fields?.length)).length}
export function blockDuplicateImportPhones(rows) {
 const counts=new Map();for(const r of rows){const p=r.values?.phone;if(p)counts.set(p,(counts.get(p)||0)+1);}
 return rows.map(r=>counts.get(r.values?.phone)>1?{...r,classification:'conflict',reason:'Duplicate normalized phone in file. Resolve duplicate rows before importing.'}:r);
}
