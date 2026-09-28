// Local-only rehearsal. No remote database URL or credentials are accepted.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
const container=process.env.REHEARSAL_CONTAINER || 'feedx-payroll-v1-rehearsal';
const database=process.env.REHEARSAL_DATABASE || 'restaurant_po_reservation_replay';
const evidence=JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sourceLines=JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const migration='20260927152000_restaurant_po_source_reservations_transactional.sql';
const manifest=[
 migration,
 '20260927154339_restaurant_legacy_financial_read_permissions.sql',
];
const args=['exec','-i',container,'psql','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-Atq'];
function sql(query) {
 const r=spawnSync('docker',args,{input:query,encoding:'utf8',maxBuffer:10e6});
 if(r.status!==0) throw new Error(r.stderr);
 return r.stdout.trim();
}
function parallel(query) {
 return new Promise(resolve=>{
  const p=spawn('docker',args); let out='',err='';
  p.stdout.on('data',s=>out+=s);p.stderr.on('data',s=>err+=s);
  p.on('close',code=>resolve({code,out:out.trim(),err}));p.stdin.end(query);
 });
}
const literal=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
function insert(table,records) {
 if(!records.length)return '';
 const unique=[...new Map(records.map(r=>[r.id||r.request_id,r])).values()];
 return `insert into ${table} select * from jsonb_populate_recordset(null::${table},${literal(unique)});\n`;
}
// Skeleton masters satisfy the Production schema FKs; evidence rows below are
// exact read-only exports, not re-created business facts or altered references.
let seed='begin;\n';
const orders=evidence.orders;
const actorIds=new Set(orders.flatMap(e=>[e.po.created_by,e.source.created_by,...e.receipts.map(r=>r.received_by),...e.movements.map(m=>m.created_by)]).filter(Boolean));
for(const id of actorIds)seed+=`insert into auth.users(id) values('${id}');\n`;
seed+=`select set_config('request.jwt.claim.sub','${orders[0].po.created_by}',true);\n`;
seed+=`insert into public.outlets(id,name,code) values('${orders[0].po.outlet_id}','Hola Hola Kopitiam Ipoh','HLIPH');\n`;
for(const [id,name] of new Map(orders.map(e=>[e.po.supplier_id,e.supplier])))seed+=`insert into public.suppliers(id,name) values('${id}',${literal(name)} #>> '{}');\n`;
seed+=`insert into public.employees(id,full_name) values('${orders[0].source.submitted_by}','LOCAL ONLY source actor');\n`;
seed+=`insert into public.inventory_stock_check_groups(id,outlet_id,name) values('${orders[0].source.group_id}','${orders[0].po.outlet_id}','Groceries');\n`;
const itemNames=new Map(orders.flatMap(e=>e.items.map(i=>[i.item_id,i.item_name])));
for(const id of new Set(sourceLines.map(i=>i.item_id)))seed+=`insert into public.inventory_items(id,item_name) values('${id}',${literal(itemNames.get(id)||'LOCAL source item')} #>> '{}');\n`;
for(const id of new Set(sourceLines.map(i=>i.category_id).filter(Boolean)))seed+=`insert into public.inventory_categories(id,name) values('${id}','LOCAL source category');\n`;
seed+=insert('public.inventory_stock_checks',[orders[0].source]);
seed+=insert('public.inventory_stock_check_items',sourceLines);
// Six explicitly local manual placeholders reproduce the earlier global-day
// numbering positions, without copying unrelated Production PO evidence.
for(let i=0;i<6;i++)seed+=`insert into public.inventory_purchase_orders(po_no,outlet_id,supplier_id,status,source_type,created_at) values('LOCAL NUMBER CONTEXT ${i}','${orders[0].po.outlet_id}','${orders[0].po.supplier_id}','draft','manual','2026-09-14T00:00:0${i}Z');\n`;
seed+=insert('public.inventory_purchase_orders',orders.map(e=>e.po));
seed+=insert('public.inventory_purchase_order_items',orders.flatMap(e=>e.items.map(({item_name,...i})=>i)));
seed+=insert('public.inventory_purchase_receipts',orders.flatMap(e=>e.receipts.map(({lines,...r})=>r)));
seed+=insert('public.inventory_purchase_receipt_items',orders.flatMap(e=>e.receipts.flatMap(r=>r.lines)));
seed+=insert('public.inventory_movements',orders.flatMap(e=>e.movements));
seed+=insert('public.inventory_lifecycle_requests',evidence.dependencies.filter(d=>d.kind==='request').map(d=>d.evidence));
seed+='commit;';
if (!process.env.REHEARSAL_PRESEEDED) sql(seed);
if (process.env.REHEARSAL_SEED_ONLY) {
 console.log('LOCAL HISTORICAL EVIDENCE SEEDED');
 process.exit(0);
}
const tables=['inventory_stock_checks','inventory_stock_check_items','inventory_purchase_orders','inventory_purchase_order_items','inventory_purchase_receipts','inventory_purchase_receipt_items','inventory_movements','inventory_lifecycle_requests'];
const columns=Object.fromEntries(tables.map(t=>[t,sql(`select string_agg(quote_ident(column_name),',' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='${t}';`)]));
const snapshot=()=>Object.fromEntries(tables.map(t=>[t,sql(`select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from(select ${columns[t]} from public.${t})x;`)]));
const before=snapshot();
if (!process.env.REHEARSAL_MIGRATED) for(const file of manifest) {sql(`set check_function_bodies=off;\n${fs.readFileSync('supabase/migrations/'+file,'utf8')}`);console.log('MIGRATION PASS '+file);}
assert.deepEqual(snapshot(),before);
for(const n of evidence.legacyDisplayNumbers)assert.equal(sql(`select business_po_no from public.inventory_purchase_orders where id='${n.id}';`),n.legacy_business_display);
assert.equal(sql('select count(*) from inventory_authority.purchase_order_source_reservations where cardinality(active_po_ids)=2;'),'7');
console.log('HISTORICAL PO PRESERVATION = PASS (all original columns across eight evidence tables)');

// Independent local disposable fixtures, never one of the historical POs.
const outlet=randomUUID(),supplier=randomUUID(),supplier2=randomUUID(),check=randomUUID(),check2=randomUUID(),item=randomUUID(),line=randomUUID(),line2=randomUUID(),actor=randomUUID(),employee=randomUUID(),role=sql("select id from public.roles where name='Owner' limit 1;")||randomUUID();
const extraItem=randomUUID(),extraLine=randomUUID();
sql(`begin;
insert into auth.users(id) values('${actor}');
select set_config('request.jwt.claim.sub','${actor}',true);
insert into public.roles(id,name,is_system_role,outlet_access_type) values('${role}','Owner',true,'all') on conflict (id) do nothing;
insert into public.employees(id,full_name,auth_user_id,role_id,enable_system_login,access_state) values('${employee}','LOCAL ONLY reservation reviewer','${actor}','${role}',true,'active');
insert into public.outlets(id,name,code) values('${outlet}','LOCAL ONLY reservation outlet','L${outlet.slice(0,5)}');
insert into public.suppliers(id,name) values('${supplier}','LOCAL supplier A ${supplier}'),('${supplier2}','LOCAL supplier B ${supplier2}');
insert into public.supplier_outlets(supplier_id,outlet_id) values('${supplier}','${outlet}'),('${supplier2}','${outlet}');
insert into public.inventory_items(id,item_name,unit) values('${item}','LOCAL item','pcs');
insert into public.inventory_item_outlets(inventory_item_id,outlet_id) values('${item}','${outlet}');
insert into public.inventory_item_outlet_suppliers(inventory_item_outlet_id,supplier_id)
select id,s from public.inventory_item_outlets cross join unnest(array['${supplier}'::uuid,'${supplier2}'::uuid]) s where outlet_id='${outlet}';
insert into public.inventory_stock_checks(id,outlet_id,status,stock_check_type,check_date) values('${check}','${outlet}','draft','scheduled',current_date),('${check2}','${outlet}','draft','scheduled',current_date);
insert into public.inventory_stock_check_items(id,stock_check_id,item_id,par_level_quantity,actual_count_quantity,unit) values('${line}','${check}','${item}',10,2,'pcs'),('${line2}','${check2}','${item}',10,2,'pcs');
insert into public.inventory_items(id,item_name,unit) values('${extraItem}','LOCAL second item','pcs');
insert into public.inventory_item_outlets(inventory_item_id,outlet_id) values('${extraItem}','${outlet}');
insert into public.inventory_item_outlet_suppliers(inventory_item_outlet_id,supplier_id) select id,'${supplier2}' from public.inventory_item_outlets where inventory_item_id='${extraItem}';
insert into public.inventory_stock_check_items(id,stock_check_id,item_id,par_level_quantity,actual_count_quantity,unit) values('${extraLine}','${check}','${extraItem}',5,1,'pcs');
update public.inventory_stock_checks set status='submitted' where id in ('${check}','${check2}');
commit;`);
const request=randomUUID();
const order={outlet_id:outlet,supplier_id:supplier,source_type:'stock_check',source_stock_check_id:check,po_no:'LOCAL-RACE'};
const items=[{item_id:item,requested_qty:8,unit:'pcs',source_stock_check_item_id:line}];
const auth=`select set_config('request.jwt.claim.sub','${actor}',true); set local role authenticated;`;
const command=(req,po=order,lines=items)=>`select public.inventory_save_purchase_order('${req}',${literal(po)},${literal(lines)});`;
const tx=(cmd,delay=false)=>`begin;${auth}${cmd}${delay?'select pg_sleep(0.4);':''}commit;`;
const race=await Promise.all([parallel(tx(command(request),true)),parallel(tx(command(randomUUID()),true))]);
assert.equal(race.filter(r=>r.code===0).length,1,JSON.stringify(race));
const winner=race[0].code===0?request:null;
const winnerRequest=winner||sql(`select request_id from public.inventory_lifecycle_requests where outlet_id='${outlet}' and operation='purchase_order';`);
assert.equal(sql(`select count(*) from public.inventory_purchase_orders where source_stock_check_id='${check}' and supplier_id='${supplier}';`),'1');
const first=JSON.parse(sql(`select result from public.inventory_lifecycle_requests where request_id='${winnerRequest}';`));
const replay=sql(tx(command(winnerRequest))).split('\n').find(l=>l.startsWith('{'));
assert.deepEqual(JSON.parse(replay),first);
assert.equal(sql(`select count(*) from public.inventory_lifecycle_requests where request_id='${winnerRequest}';`),'1');
console.log('CONCURRENT CREATION = PASS; IDEMPOTENT RETRY = PASS');

// Test the reservation itself with owner writes so RPC source locks/validation
// cannot mask a broken backstop. Different supplier is legitimate only for a
// distinct eligible source item (source-item validation remains unchanged).
sql(tx(command(randomUUID(),{...order,supplier_id:supplier2,po_no:'LOCAL-SUPPLIER'},[{item_id:extraItem,requested_qty:4,unit:'pcs',source_stock_check_item_id:extraLine}])));
sql(tx(command(randomUUID(),{...order,source_stock_check_id:check2,po_no:'LOCAL-SOURCE'},[{...items[0],source_stock_check_item_id:line2}])));
const backstopSource=randomUUID();
const raw=()=>`begin; insert into public.inventory_purchase_orders(outlet_id,supplier_id,status,source_type,source_stock_check_id) values('${outlet}','${supplier}','draft','stock_check','${backstopSource}');select pg_sleep(0.4);commit;`;
sql(`insert into public.inventory_stock_checks(id,outlet_id,status,stock_check_type) values('${backstopSource}','${outlet}','submitted','scheduled');`);
const rawRace=await Promise.all([parallel(raw()),parallel(raw())]);
assert.equal(rawRace.filter(r=>r.code===0).length,1,JSON.stringify(rawRace));
assert.match(rawRace.find(r=>r.code!==0).err,/already exists/);

// Cancellation of a legacy sibling cannot release the other. Roll back all
// local historical lifecycle probes; the final snapshot must still match.
const legacy=orders.find(e=>e.po.status==='draft');
sql(`begin; update public.inventory_purchase_orders set status='cancelled' where id='${legacy.po.id}';
do $$begin if (select cardinality(active_po_ids) from inventory_authority.purchase_order_source_reservations where source_stock_check_id='${legacy.po.source_stock_check_id}' and supplier_id='${legacy.po.supplier_id}')<>1 then raise exception 'Sibling reservation lost'; end if;end$$;rollback;`);
const failed=await parallel(`begin;insert into public.inventory_purchase_orders(outlet_id,supplier_id,status,source_type,source_stock_check_id) values('${legacy.po.outlet_id}','${legacy.po.supplier_id}','draft','stock_check','${legacy.po.source_stock_check_id}');commit;`);
assert.notEqual(failed.code,0);
// Release an ordinary reservation through the existing canonical cancellation.
sql(tx(`select public.inventory_transition_purchase_order('${first.order.id}','${randomUUID()}','cancel','LOCAL replacement test');`));
sql(tx(command(randomUUID(),{...order,po_no:'LOCAL-REPLACEMENT'})));
// Security and original historical evidence remain intact after all probes.
assert.equal(sql("select has_schema_privilege('authenticated','inventory_authority','USAGE') or has_table_privilege('authenticated','inventory_authority.purchase_order_source_reservations','INSERT') or has_function_privilege('authenticated','inventory_authority.reserve_purchase_order_source()','EXECUTE');"),'f');
for(const t of tables){const original=JSON.parse(before[t]);for(const row of original){const key=t==='inventory_lifecycle_requests'?'request_id':'id';const current=JSON.parse(sql(`select to_jsonb(x) from(select ${columns[t]} from public.${t} where ${key}='${row[key]}')x;`));assert.deepEqual(current,row);}}
console.log('PROSPECTIVE UNIQUENESS = PASS (canonical + owner races, different keys, sibling cancellation, replacement, privacy)');
console.log(JSON.stringify({manifest:manifest.map(file=>({file,sha256:createHash('sha256').update(fs.readFileSync('supabase/migrations/'+file)).digest('hex')})),historicalPOs:14,receipts:8,movements:36,requests:22},null,2));
