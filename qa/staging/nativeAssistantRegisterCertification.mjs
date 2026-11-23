import assert from 'node:assert/strict';
import {checkFinanceCostTrend} from './nativeAssistantFinanceCostCertification.mjs';
import {checkCapture} from './nativeAssistantOperationalCertification.mjs';

// The noun is the grain of the owning read model. A roster entry is a duty
// assignment, a recipe row is a version, and an observed post is not an impression.
const counts=[
 ['Finance','read_accounting_source_health','owner-visible AutoCount connection records matching the selected filters, including historical bindings','(?:accounting |autocount |source )?(?:connections?|bindings?)(?: records?)?'],
 ['Restaurant','read_inventory_stock_evidence','matching stock positions','(?:stock )?positions?'],
 ['Restaurant','read_inventory_par_levels','item-to-outlet par configurations','(?:par )?(?:settings|configurations?)'],
 ['Factory','read_factory_audit_events','Factory audit events','(?:audit )?events?'],
 ['Factory','read_factory_raw_control_standards','raw material acceptance standards','(?:acceptance )?standards?'],
 ['Factory','read_factory_raw_control_evidence','raw material receipt lines','(?:receipt|receiving) lines?'],
 ['Factory','read_factory_storage_control','finished product storage records','(?:storage )?records?'],
 ['Factory','read_factory_processing_control','completed production QC entries','(?:production )?QC (?:entries|records?)'],
 ['Factory','read_factory_feedback_campaigns','Factory feedback campaigns','(?:feedback )?campaigns?'],
 ['Factory','read_factory_label_configuration','product label configurations','(?:product )?label (?:configurations?|records?)','page'],
 ['Factory','read_factory_transfers','Factory internal transfers','(?:internal )?transfers?','page'],
 ['Factory','read_factory_cash','matching petty cash transactions','(?:petty cash )?transactions?','page'],
 ['HR','read_role_directory','role definitions','role (?:records?|definitions?)'],
 ['HR','read_audit_event_metadata','retained audit events','(?:audit )?events?'],
 ['HR','read_payroll_run_status','authorized payroll periods','payroll periods?'],
 ['Crew','read_crew_performance_snapshot','matching saved performance results','(?:performance )?results?'],
 ['Marketing','read_marketing_ads_evidence','recorded ad reporting snapshots','(?:ad |reporting )?(?:snapshots?|reports?)'],
 ['Restaurant','read_sales_records','sales input entries','sales (?:input )?(?:entries|records?)'],
 ['Restaurant','read_inventory_waste','inventory waste records','waste (?:entries|records?)'],
 ['Restaurant','read_inventory_orders','inventory purchase orders','(?:purchase )?orders?'],
 ['Restaurant','read_inventory_check_groups','stock check groups','(?:stock[- ]check )?groups?'],
 ['Restaurant','read_inventory_recipe_catalogue','inventory recipes','(?:recipe catalogue entries|recipes?)'],
 ['Factory','read_factory_suppliers','Factory suppliers','(?:factory )?suppliers?'],
 ['Factory','read_factory_customers','Factory customers','(?:factory )?customers?'],
 ['Factory','read_factory_locations','Factory storage locations','(?:storage )?locations?'],
 ['Factory','read_factory_production_records','Factory production records','production (?:entries|records?)'],
 ['Factory','read_factory_recipe_versions','Factory recipe versions','(?:recipe )?versions?'],
 ['Factory','read_factory_equipment_cleaning_requirements','equipment cleaning requirements','(?:cleaning )?requirements?'],
 ['HR','read_legal_entities','legal entities','legal entit(?:ies|y)'],
 ['HR','read_employee_notice_status','employee notices','(?:employee )?notices?'],
 ['HR','read_employment_document_status','employment document records','employment documents?(?: records?)?'],
 ['HR','read_recruitment_openings','recruitment openings','(?:recruitment )?openings?'],
 ['Crew','read_crew_roster','duty roster entries','(?:roster (?:entries|assignments?)|duty assignments?)'],
 ['Crew','read_crew_skill_requirements','registered skill definitions','skill definitions?'],
 ['Crew','read_crew_sop_catalogue','published SOPs','published SOPs?'],
 ['Crew','read_crew_onboarding_progress','Crew members in the onboarding progress view, including those without an enrollment','(?:crew members?|member progress records?)'],
 ['Marketing','read_marketing_campaigns','campaigns','campaigns?'],
 ['Marketing','read_marketing_audiences','audiences','audiences?'],
 ['Marketing','read_marketing_connection_health','channel connections','(?:channel )?connections?'],
 ['Marketing','read_marketing_creator_posts','recorded creator posts','(?:creator )?posts?'],
 ['Marketing','read_marketing_social_performance','reported observation windows','(?:observation|reporting) (?:windows?|records?)'],
 ['Marketing','read_platform_team_access','visible organization team members','(?:team )?members?'],
 ['Marketing','read_platform_brands','visible Brands','brands?'],
];

function validateFinalAmount(reply,amount){
 const amounts=[...reply.matchAll(/(?:RM|MYR)\s*(-?\d+(?:\.\d+)?)\b/giu)].map(match=>Number(match[1]));
 assert.deepEqual([...new Set(amounts)],amount===null?[]:[amount],'Closing value is missing, invented, or contradicted');
}

const monthLabels=['Jan(?:uary)?','Feb(?:ruary)?','Mar(?:ch)?','Apr(?:il)?','May','Jun(?:e)?','Jul(?:y)?','Aug(?:ust)?','Sep(?:t(?:ember)?)?','Oct(?:ober)?','Nov(?:ember)?','Dec(?:ember)?'];
const chineseMonths=['一','二','三','四','五','六','七','八','九','十','十一','十二'];
function monthLabel(m){return '(?:(?<![0-9])0?'+m+'\\s*月|(?<![一二三四五六七八九十])'+chineseMonths[m-1]+'月|\\b'+monthLabels[m-1]+'\\b|20\\d{2}-'+String(m).padStart(2,'0')+'(?!\\d))';}
function finalMoney(value){
 const [whole,frac]=value.toFixed(2).split('.');
 return '(?<![.\\d-])'+whole+(frac==='00'?'(?:\\.0{1,2})?':'\\.'+frac.replace(/0$/,'0?'))+'(?!\\d|\\.\\d)';
}
function annualPurchaseScope(scope){
 const {outlet_id,outlet_name,month,...parameters}=scope;
 assert(outlet_id||outlet_name,'Missing outlet scope');
 assert.match(month,/^20\d{2}-(?:0[1-9]|1[0-2])-01$/u,'A valid reporting-year anchor is required');
 return {...parameters,year:Number(month.slice(0,4))};
}
function checkRecordedSupplierYear(e,reply,src){
 assert.equal(src.scope.mode,'supplier_year');assert.equal(src.scope.supplier_name,null);assert.equal(src.scope.page,1);
 assert(Number.isSafeInteger(src.year)&&src.year===Number(src.scope.month.slice(0,4)));
 assert.equal(e.year,src.year);assert.equal(e.currency,'MYR');assert.equal(e.aggregate_complete,true);
 const name=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
 assert(src.outlet_name&&e.outlet,'Independently captured outlet required');
 const ownerId=src.outlet_id||src.scope.outlet_id;
 if(ownerId)assert.equal(e.outlet.id,ownerId,'Wrong confirmed outlet');
 if(e.outlet.name||!ownerId)assert.equal(name(e.outlet.name),name(src.outlet_name),'Wrong outlet name');
 for(const scope of [src.scope,e.requested_scope]){
  if(scope.outlet_id)assert.equal(scope.outlet_id,e.outlet.id,'Conflicting requested outlet identity');
  if(scope.outlet_name)assert([src.outlet_name,e.outlet.code].filter(Boolean).some(n=>name(n)===name(scope.outlet_name)),'Conflicting requested outlet name');
 }
 assert(Array.isArray(src.months)&&src.months.length>0&&src.months.every(row=>Number.isInteger(row.month)&&row.month>=1&&row.month<=12&&Number.isFinite(row.amount)));
 const recorded=new Map(src.months.map(row=>[row.month,row.amount]));assert.equal(recorded.size,src.months.length);
 const missing=monthLabels.flatMap((_,i)=>recorded.has(i+1)?[]:[i+1]);
 assert.equal(Math.round(100*src.annual_recorded_total),src.months.reduce((sum,row)=>sum+Math.round(100*row.amount),0));
 assert.deepEqual(e.monthly_totals.map(({month,amount})=>({month,amount})),monthLabels.map((_,i)=>({month:i+1,amount:recorded.get(i+1)??null})));
 assert.equal(e.recorded_total,src.annual_recorded_total);assert.deepEqual(e.missing_months,missing);assert.equal(e.period_complete,missing.length===0);
 assert.match(reply,/MYR|RM|令吉|马币|馬幣/iu);
 const text=reply.replaceAll('**','').replace(/(?<=\d),(?=\d{3}(?:\D|$))/gu,'');
 for(const row of src.months){
  // A label must bind its own amount in the same table row or sentence fragment.
  assert.match(text,new RegExp(monthLabel(row.month)+'[\\s:：|()（）=—–-]*(?:采购(?:金额)?|採購(?:金額)?|purchases?)?[\\s:：|()（）=—–-]*(?:(?:MYR|RM|令吉|马币|馬幣)\\s*)?'+finalMoney(row.amount),'iu'));
 }
 const annual='(?:全年|年度|已记录总额|已記錄總額|合计|合計|总计|總計|annual|year(?:ly)?\\s+total|recorded total|total recorded|total)';
 const yearly=text.split(/[。；;\n]/u).filter(s=>new RegExp(annual,'iu').test(s));
 assert(yearly.some(s=>new RegExp(finalMoney(src.annual_recorded_total),'iu').test(s)),'Annual total is missing or mislabelled');
 if(!missing.length)return;
 const lack=/无(?:任何)?(?:已)?[采购購採购购买買]*记录|無(?:任何)?(?:已)?[采购購採购购买買]*紀錄|没有|沒有|未.{0,5}(?:记录|記錄|录入|錄入)|no (?:recorded )?(?:purchase |supplier )?(?:entries|records|purchases)|no data|not recorded|unrecorded/iu;
 const absent=text.split(/[。；;\n]/u).filter(s=>lack.test(s));assert(absent.length,'Missing months must be described as having no recorded purchases');
 for(const m of missing){
  const explicit=absent.some(s=>new RegExp(monthLabel(m),'iu').test(s));
  if(explicit)continue;
  assert(missing.some(start=>start<=m&&missing.some(end=>end>=m&&start<end&&Array.from({length:end-start+1},(_,i)=>start+i).every(n=>missing.includes(n))&&
   absent.some(s=>new RegExp('(?:'+monthLabel(start)+'|(?<!\\d)'+start+')\\s*(?:至|到|[-–—~～]|through|to)\\s*'+monthLabel(end),'iu').test(s)))),'Missing month '+m+' not identified');
 }
}

export function registerScenarios(operations,canonicalPath){
 const map=new Map(operations.map(op=>[op.id,op]));
 const wrap=(id,domain,question,check,businessScope=scope=>scope,captureOwner)=>{
  const op=map.get(id);
  assert(op?.kind==='READ','Scenario needs a bound READ: '+id);
  const owner={owner:captureOwner||op.module_id,canonicalRoute:canonicalPath(captureOwner||op.module_id),rpc:op.rpc};
  return {domain,operations:[id],medium:'text',question,independentOwnerCheck:true,
   check:([e],reply,source,turn)=>{
    checkCapture(owner,source,turn,e.as_of);
    assert.equal(e.source,op.source||op.moduleInterface.source,'Wrong business authority');
    assert.equal(e.query_outcome,'SUCCESS');
    assert(Number.isFinite(Date.parse(e.as_of)),'Saved evidence freshness is missing');
    assert.deepEqual(businessScope(e.requested_scope),businessScope(source.scope),'Saved scope differs from independent capture');
    check(e,reply,source);
   }};
 };
 const cases={};
 cases.fg_product_group_page=wrap('read_factory_finished_goods','Factory',
  'List the Factory product families and standalone products on this page, their matching packaging SKU counts and the total number of groups.',(e,reply,s)=>{
   assert.equal(s.capture.method,'admin_view');
   assert.equal(s.scope.measure,'product');assert.equal(s.scope.mode,'list');
   assert.equal(e.aggregate_complete,true);assert.equal(e.page_size,20);assert.equal(e.page,s.scope.page);
   assert.equal(s.all_group_pages,true);
   const groups=s.groups;
   assert(Array.isArray(groups)&&groups.every(g=>g.key&&g.name&&Number.isSafeInteger(g.skus)&&g.skus>=0));
   assert.equal(new Set(groups.map(g=>g.key)).size,groups.length);
   assert.equal(e.total_matching,groups.length);
   const start=(e.page-1)*20;
   const page=[...groups].sort((a,b)=>a.name.localeCompare(b.name,'en')||a.key.localeCompare(b.key,'en')).slice(start,start+20);
   assert.deepEqual(e.rows.map(r=>[r.id,r.product_group_name,r.matching_packaging_skus]),page.map(r=>[r.key,r.name,r.skus]));
   assert.equal(e.truncated,start+page.length<groups.length);
   assert.match(reply,new RegExp('(?<!\\d)'+groups.length+'\\s+(?:grouped products?|product groups?)\\b','iu'));
   const lines=reply.split(/\n/u);
   for(const group of page){
    const name=group.name.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
    const pair=new RegExp('(?<![\\p{L}\\p{N}])'+name+'\\s*(?:[(:|—-]|has|with)\\s*'+group.skus+'\\s+(?:matching )?packaging SKUs?\\b','iu');
    const index=lines.findIndex(line=>pair.test(line));
    assert(index>=0,'Answer omitted a group or mismatched its packaging SKU count');
    lines.splice(index,1);
   }
  });
 cases.fg_filtered_product_groups=wrap('read_factory_finished_goods','Factory',
  'How many matching products are in the Finished Goods grouped view? Include the selected filter in the answer.',(e,reply,s)=>{
   assert.equal(s.capture.method,'admin_view');
   assert.equal(s.scope.measure,'product');assert.equal(s.scope.mode,'summary');assert.equal(s.scope.page,1);
   assert.equal(e.aggregate_complete,true);assert.equal(e.measure,'product');assert.deepEqual(e.rows,[]);
   assert.equal(s.all_group_pages,true,'Capture every matching grouped-view page');
   assert(Array.isArray(s.group_keys)&&s.group_keys.every(key=>typeof key==='string'&&key.trim()));
   assert.equal(new Set(s.group_keys).size,s.group_keys.length);assert.equal(s.admin_group_count,s.group_keys.length);
   assert.equal(e.total_matching,s.admin_group_count);
   const qualifiers=[s.scope.query,s.scope.category_name,s.scope.tag_name,s.scope.status!=='all'&&s.scope.status,s.scope.availability!=='all'&&s.scope.availability].filter(Boolean);
   assert(qualifiers.length,'At least one real filter is required');
   for(const label of [s.scope.query,s.scope.category_name,s.scope.tag_name].filter(Boolean))assert(reply.toLowerCase().includes(label.toLowerCase()),'Answer omitted a named filter');
   if(s.scope.status==='active')assert.match(reply,/\b(?:active|aktif)\b|启用|啟用|活跃|活躍/iu);
   if(s.scope.status==='archived')assert.match(reply,/\b(?:archived|diarkibkan)\b|归档|歸檔/iu);
   if(s.scope.availability==='out_of_stock')assert.match(reply,/out[ -]of[ -]stock|habis stok|缺货|缺貨/iu);
   const n='(?<![.\\d])'+s.group_keys.length+'(?!\\d|\\.\\d)';
   assert.match(reply,new RegExp(n+'\\s*(?:matching\\s+)?(?:grouped products?|product (?:groups?|families)|kumpulan produk|(?:个|個)?(?:成品[组組]|产品组|產品組))','iu'));
  });
 for(const [domain,id,label,noun,boundary] of counts){
  cases[id+'_filtered_register_count']=wrap(id,domain,'How many '+label+' match those conditions?',(e,reply,s)=>{
   if(boundary!=='page')assert.equal(s.scope.mode,'summary');
   assert.equal(s.scope.page,1);
   assert(Number.isSafeInteger(s.count)&&s.count>=0,'Independent exact filtered count required');
   assert.equal(e.aggregate_complete,true);
   assert.equal(e.total_matching,s.count);
   if(boundary==='page'){
    assert(Number.isInteger(e.page_size)&&e.page_size>0);
    assert.deepEqual(e.rows.map(row=>row.id),s.page_ids,'Canonical first page differs');
    assert.equal(e.rows.length,Math.min(e.page_size,s.count));
    assert.equal(e.truncated,s.count>e.page_size);
   }else assert.equal(e.rows.length,0,'Expected the summary query');
   const words='(?:'+noun+')';
   const stated=[...reply.matchAll(new RegExp('(?<![\\d.-])(\\d+)\\s+(?:(?:matching|recorded|registered|active|archived|authorized|published)\\s+)*'+words+'\\b|\\b'+words+'\\s*(?:count|total)?\\s*(?:[:=]|is|are|total(?:ed)?|stand at)\\s*(\\d+)(?!\\d|\\.\\d)','giu'))].map(m=>Number(m[1]??m[2]));
   assert.deepEqual([...new Set(stated)],[s.count],'Final answer must bind the actual count to its business unit');
  });
 }
 cases.crew_review_assignment_count=wrap('read_crew_task_snapshot','Crew',
  'How many task assignments require review in this date range? Give one recorded task name when available.',(e,reply,s)=>{
   assert.equal(s.scope.listing,'review_queue');
   assert.equal(e.total_matching,s.count);assert.equal(e.aggregate_complete,true);
   assert.deepEqual(e.rows.map(r=>[r.name,r.business_date,r.status]),s.rows);
   assert.match(reply,new RegExp('(?<![.\\d])'+s.count+'\\s+(?:task )?assignments?','iu'));
   if(s.count>0)assert(s.rows.some(([name])=>typeof name==='string'&&reply.toLowerCase().includes(name.toLowerCase())));
  });
 cases.workflow_source_ceiling=wrap('read_marketing_workflows','Marketing',
  'How many workflow definitions can the Brand register establish? Distinguish an exact count from the source limit.',(e,reply,s)=>{
   assert(Number.isSafeInteger(s.visible)&&s.visible>=0&&s.visible<=100);
   assert.equal(e.total_lower_bound,s.visible);
   assert.equal(e.aggregate_complete,s.visible<100);
   assert.equal(e.total_matching,s.visible<100?s.visible:null);
   assert.match(reply,new RegExp('(?<![.\\d])'+s.visible+'\\s+(?:workflow )?definitions?','iu'));
   if(s.visible===100){assert.match(reply,/at least|lower bound|latest 100|only (?:the )?first 100|full (?:total|count) (?:is )?unknown/iu);
    assert.doesNotMatch(reply,/exactly 100|100 (?:workflow )?definitions? in total/iu);}
  });
 cases.receiving_quantity_units=wrap('read_factory_receiving_summary','Factory',
  'How many receipt documents and lines are recorded for this supplier and period? Does the receipt summary establish a total weight in kilograms?',(e,reply,s)=>{
   assert.equal(e.summary.documents,s.documents);assert.equal(e.summary.items,s.lines);
   assert.equal(e.summary.total_qty,s.source_quantity);
   assert.match(reply,new RegExp('(?<![.\\d])'+s.documents+'\\s+(?:receiving |receipt )?documents?','iu'));
   assert.match(reply,new RegExp('(?<![.\\d])'+s.lines+'\\s+(?:receipt |item )?(?:lines?|rows?)','iu'));
   assert.match(reply,/unit|weight|kilogram/iu);assert.match(reply,/cannot|unknown|mixed|no (?:verified |common |shared )|unavailable|not (?:a |established|given|available)/iu);
   assert.doesNotMatch(reply,/[-+]?\d+(?:\.\d+)?\s*(?:kg|kilograms?)\b/iu);
  });
 cases.restaurant_supplier_monthly_recorded_purchases=wrap('read_purchase_comparison','Restaurant',
  'What are this outlet’s supplier purchases by month, recorded total for the year, and months without purchase entries?',checkRecordedSupplierYear,annualPurchaseScope);
 for(const [id,authority,dateBasis,unit] of [
  ['read_factory_job_summary','factory_list_job_order_records','planned_date','job orders'],
  ['read_factory_dispatch_summary','factory_finished_good_dispatches','dispatch_date','dispatches'],
  ['read_factory_raw_checks','factory_raw_material_stock_checks','check_date','raw material stock checks'],
  ['read_factory_product_checks','factory_product_stock_checks','check_date','finished product stock checks'],
 ]){
  cases[id+'_filtered_header_count']=wrap(id,'Factory','For the specified status and date range, how many '+unit+' are recorded? Count documents rather than items or units.',(e,reply,src)=>{
   assert.equal(src.capture.method,'admin_view');assert.equal(src.scope.mode,'count');assert.equal(src.scope.page,1);
   assert(src.scope.from&&src.scope.to&&src.scope.status,'Select an explicit status and calendar range');
   assert(Array.isArray(src.matching_ids)&&src.matching_ids.every(id=>typeof id==='string'&&id.length));
   assert.equal(new Set(src.matching_ids).size,src.matching_ids.length);assert.equal(e.header_authority,authority);
   assert.equal(e.date_basis,dateBasis);assert.equal(e.aggregate_complete,true);assert.equal(e.total_matching,src.matching_ids.length);
   const count=src.matching_ids.length||'(?:0|zero|no)';
   const noun=unit==='dispatches'?'(?:dispatches|dispatch(?: records?)?)':unit==='job orders'?'job orders?':'(?:raw.material |finished.product |product |material )?stock[ -]checks?';
   assert.match(reply,new RegExp('(?<![\\d.])'+count+'(?![\\d.])\\s+(?:matching |'+src.scope.status.replaceAll('_','[ -]')+' )*'+noun,'iu'));
   assert.match(reply,new RegExp(src.scope.status.replaceAll('_','[ -]'),'iu'),'The answer must retain the selected status');
  });
 }
 for(const register of ['schedule','history']){
  const history=register==='history';
  cases['factory_calibration_'+register+'_count']=wrap('read_factory_calibration','Factory',history
   ?'How many calibration records match the selected verification status and calibration dates? Count the records, not the current requirements.'
   :'How many current calibration requirements match the selected equipment status and due dates? Count requirements, not historical calibrations.',(e,reply,src)=>{
    assert.equal(src.capture.method,'admin_view','Capture the independently scoped Calibration Schedule or Record tab');
    assert.equal(src.scope.register,register);assert.equal(src.scope.mode,'summary');assert.equal(src.scope.page,1);
    assert(src.scope.status&&src.scope.from&&src.scope.to,'Provide an independently selected status and date range');
    assert(Array.isArray(src.matching_ids)&&src.matching_ids.every(id=>typeof id==='string'&&id.length));
    assert.equal(new Set(src.matching_ids).size,src.matching_ids.length);
    assert.equal(e.register,register);assert.equal(e.evidence_rpc,'factory_mesti_calibration_'+(history?'records':'schedule'));
    assert.equal(e.date_basis,history?'calibrated_date':'next_due');assert.equal(e.aggregate_complete,true);
    assert.equal(e.total_matching,src.matching_ids.length);
    const units=history?'(?:calibration )?(?:records?|calibrations?)':'(?:current |calibration |schedule(?:d)? )*(?:requirements?|scheduled calibrations?)';
    const n=src.matching_ids.length,quantity=n?'(?<![.\\d])'+n+'(?![.\\d])':'(?:0|zero|no)';
    assert.match(reply,new RegExp(quantity+'\\s+(?:matching |verified |recorded |overdue |due |pending )*'+units,'iu'));
    assert.match(reply,new RegExp(src.scope.status.replaceAll('_','[ -]'),'iu'),'Report the selected status alongside the count');
   });
 }
 cases.factory_recipe_standards_and_versions=wrap('read_factory_recipe_versions','Factory',
  'How many products have active current recipe standards out of all current standards? Compare this with active saved versions out of all recorded versions.',(e,reply,s)=>{
   assert.equal(e.aggregate_complete,true);
   const count=rows=>{
    assert(Array.isArray(rows)&&rows.every(row=>row.id&&typeof row.status==='string'),'Independently read identities and statuses required');
    assert.equal(rows.length,new Set(rows.map(row=>row.id)).size);
    const by_status={active:0,draft:0,archived:0};
    for(const row of rows)by_status[row.status]=(by_status[row.status]??0)+1;
    return {total:rows.length,by_status};
   };
   const products=count(s.current_standards),versions=count(s.saved_versions);
   assert.deepEqual(e.current_products,products);assert.deepEqual(e.recorded_versions,versions);
   const population=e.requested_scope.measure==='current_products'?products:versions;
   assert.equal(e.total_matching,e.requested_scope.status==='active'?population.by_status.active:population.total);
   assert.doesNotMatch(reply,/\b(?:ingredient pric(?:es|ing)|production efficiency|breakdown of costs|cost implications)\b/iu,
    'Recipe status counts do not support an unsolicited cost or efficiency recommendation');
   for(const [noun,v] of [['(?:products?|(?:current )?(?:recipe )?standards?)',products],['(?:saved |recorded |recipe )?versions?',versions]]){
    const count=n=>'(?<![.\\d])'+n+'(?!\\d|\\.\\d)';
    const active=count(v.by_status.active),total=count(v.total);
    const ratio=active+'\\s*(?:of|out of|/)\\s*'+total;
    const labeledActive='(?:'+active+'\\s+active|active\\s*[:=]\\s*'+active+'|'+active+'\\s+(?:'+noun+'\\s+)?(?:are|were|is) active)';
    const labeledTotal='(?:'+total+'\\s+(?:in )?total|total\\s*[:=]\\s*'+total+'|out of (?:all |the )?'+total+')';
    const clauses=reply.split(/[.;\n]|,?\s+(?:whereas|while)\s+|\s+and\s+(?=(?:\d|(?:saved|recorded|current)\s))/iu);
    const statusList=new RegExp('total of\\s+'+total+'\\s+(?:current |product |recipe |saved |recorded )*'+noun+'[.:]?\\s*(?:[-•]\\s*)?active\\s*:\\s*'+active,'iu');
    assert(statusList.test(reply)||clauses.some(part=>new RegExp(noun,'iu').test(part)&&/\bactive\b/iu.test(part)&&
     (new RegExp(ratio,'iu').test(part)||(new RegExp(labeledActive,'iu').test(part)&&new RegExp(labeledTotal,'iu').test(part)))),
     'Final answer must pair active count, total and recipe population');
   }
  },scope=>{
   // Both summary measures report both full status breakdowns. The selection
   // affects total_matching, checked above. Other filters change the population.
   const {measure,status,...filters}=scope;
   assert(['current_products','versions'].includes(measure));
   assert(status==='active'||status===null);assert.equal(filters.mode,'summary');assert.equal(filters.page,1);
   assert(!filters.name&&!filters.code&&!filters.product_name);
   return filters;
  });
 cases.customer_filtered_and_brand_totals=wrap('read_brand_customer_directory','Marketing',
  'How many customers match these filters, and how many subscribed customers are recorded across this entire Brand?',(e,reply,s)=>{
   assert(s.scope.status!=='all'||s.scope.consent!=='all','A filtered source cohort is required');
   assert.equal(s.scope.page,1);
   assert(Number.isSafeInteger(s.filtered_total)&&Number.isSafeInteger(s.brand_subscribed),'Independent cohort and whole-brand totals required');
   assert.equal(e.total_matching,s.filtered_total);
   assert.equal(e.aggregate_complete,true);
   assert.equal(e.summary.subscribed,s.brand_subscribed);
   assert.match(e.summary_scope,/entire.*brand|whole.*brand/iu);
   assert.match(reply,new RegExp('(?:matching|filtered)(?: customers?)?\\s*[:=]?\\s*'+s.filtered_total+'(?!\\d|\\.\\d)|(?<![.\\d])'+s.filtered_total+'\\s+(?:matching|filtered) (?:customers?|records?)','iu'));
   assert.match(reply,new RegExp('(?:whole|entire|all|across (?:the|this))[^.\\n]{0,80}(?<!\\d)'+s.brand_subscribed+'\\s+subscribed|(?<!\\d)'+s.brand_subscribed+'\\s+subscribed[^.\\n]{0,75}(?:whole|entire|across|brand-wide)','iu'));
  });
 cases.stock_closing_publication=wrap('read_inventory_checks','Restaurant',
  'Has the submitted month-end stock check been published? Give its current revision and actual count date if recorded.',(e,reply,s)=>{
   assert.equal(s.scope.mode,'closing');
   assert.deepEqual(e.publication_state,s.state);
   assert(['published','submitted_unpublished','no_submitted_audit'].includes(s.state));
   if(s.state==='published'){
    assert(s.publication&&Number.isInteger(s.publication.revision)&&s.publication.source_audit_id,'Canonical published revision and source audit required');
    for(const key of ['source_audit_id','revision','actual_count_date','approved_at','valuation_status','valued_item_count','total_item_count'])
     assert.deepEqual(e.publication[key],s.publication[key],'Published closing evidence differs for '+key);
    assert.match(reply,/published|publication/iu);
    assert.doesNotMatch(reply,/not (?:yet )?published|unpublished|no submitted/iu);
    assert.match(reply,new RegExp('(?:revision|version|rev\\.?)\\s*[:#-]?\\s*'+s.publication.revision+'(?!\\d|\\.\\d)','iu'));
    if(s.publication.actual_count_date)assert(reply.includes(s.publication.actual_count_date));
    else assert.match(reply,/count date.{0,32}(?:unavailable|not recorded|unknown)/iu);
   }else{
    assert.equal(s.publication,null);
    assert.equal(e.publication,null);
    assert.match(reply,s.state==='submitted_unpublished'?/unpublished|not (?:yet )?published/iu:/no (?:submitted |qualifying )?(?:month-end |closing )?(?:audit|stock check)|(?:no|not) .{0,30}submit/iu);
   }
   validateFinalAmount(reply,null);
  });
 cases.finance_operational_cost_trend=wrap('read_operational_financials','Finance',
  'Show the monthly Finance cost trend for this scope in MYR.',checkFinanceCostTrend,scope=>scope,'finance_costs');
 cases.finance_closing_valuation=wrap('read_operational_financials','Finance',
  'What is the published closing stock valuation? Include its currency, valuation coverage and whether the amount is partial or complete.',(e,reply,s)=>{
   assert.equal(s.scope.measure,'closing_stock');
   assert.equal(e.comparison_closing_stock,undefined,'A single-period question returned an unrelated comparison');
   assert.deepEqual(e.closing_stock.outlet,s.outlet);
   assert.deepEqual(e.closing_stock.period,s.period);
   assert.equal(e.closing_stock.currency,'MYR');
   // Compare raw reporting fields, not a second copy of the Assistant projection.
   const src=s.closing_stock_evidence;
   assert(src===null||['partial','complete'].includes(src?.valuation_status),'Missing independent Reporting publication state');
   const status=src?.valuation_status??'unavailable';
   assert.equal(e.closing_stock.status,status);
   for(const [out,raw] of [['amount','amount'],['valued_items','valued_item_count'],['total_items','total_item_count'],['actual_count_date','actual_count_date']])
    assert.equal(e.closing_stock[out],src?.[raw]??null);
   if(status==='unavailable')assert.match(reply,/unavailable|not available|no published|not published/iu);
   else{
    assert.match(reply,new RegExp('\\b'+status+'\\b','iu'));
    if(status==='partial')assert.doesNotMatch(reply.replace(/\b(?:not|isn't) (?:complete|fully valued)\b/giu,''),/\b(?:complete|fully valued)\b/iu);
    if(src.valued_item_count!=null&&src.total_item_count!=null)
     assert.match(reply,new RegExp('(?<!\\d)'+src.valued_item_count+'\\s*(?:/|of|out of)\\s*'+src.total_item_count+'(?!\\d)','iu'));
   }
   validateFinalAmount(reply,src?.amount??null);
  });
 return cases;
}

export function registerSourceCases(samples,scenarios){
 return samples.map(source=>{
  const id=source.scenario;
  const definition=scenarios[id];
  assert(definition&&Object.prototype.hasOwnProperty.call(scenarios,id)&&definition.independentOwnerCheck&&
   (id.endsWith('_filtered_register_count')||id.endsWith('_filtered_header_count')||['fg_filtered_product_groups','fg_product_group_page','stock_closing_publication','finance_closing_valuation','finance_operational_cost_trend','customer_filtered_and_brand_totals','crew_review_assignment_count','workflow_source_ceiling','receiving_quantity_units','factory_recipe_standards_and_versions','factory_calibration_schedule_count','factory_calibration_history_count','restaurant_supplier_monthly_recorded_purchases'].includes(id)),'Unsupported register scenario');
  assert(typeof source.scope_label==='string'&&source.scope_label.trim()&&source.scope_label.length<=300,'A source-derived scope description is required');
  assert(!/[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}/i.test(source.scope_label),'Use human-readable scope in questions');
  return {id,question:source.scope_label.trim()+'. '+definition.question,source};
 });
}
