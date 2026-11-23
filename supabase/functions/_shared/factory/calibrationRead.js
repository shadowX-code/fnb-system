import {collectionRead} from '../assistant/collectionRead.js';
import {date,invalidArgument,pick} from '../assistant/readContract.js';
import {AssistantError} from '../assistantError.js';

const equipment=['equipment_code','equipment_name','location_name'];
const schedule=['id',...equipment,'calibration_type','interval_months','effective_from','last_calibration','next_due','status'];
const history=['id','scheduled_due_date','calibrated_date','result','status','recorded_at','verified_at'];
const rpcFor={schedule:'factory_mesti_calibration_schedule',history:'factory_mesti_calibration_records'};
const dateFilter={...date,nullable:true};

export const calibrationRead=collectionRead({
 id:'read_factory_calibration',module_id:'factory_mesti_calibration',label:'Equipment calibration schedule and record history',
 permission:'factory_mesti_calibration.view',source:'/factory/mesti/calibration',rpc:rpcFor.schedule,
 scope:'The current Factory schedule or the separate dated calibration records under the same human authority. Neither setup nor verification is executed.',
 description:'Count or list current requirements and their source-calculated due status, or choose register=history for retained calibration results and verification status. Date filters apply to next due on the schedule and calibrated date in history. A scheduled requirement is not a completed calibration.',
 properties:{register:{type:'string',enum:['schedule','history']},from:dateFilter,to:dateFilter},
 normalizeArguments:a=>({register:'schedule',from:null,to:null,...a}),
 check(a){
  if(Boolean(a.from)!==Boolean(a.to)||a.from&&a.from>a.to)invalidArgument('invalid_date_range','from');
  if(a.result&&a.register!=='history')invalidArgument('unsupported_value','result');
  if(a.calibration_type&&a.register!=='schedule')invalidArgument('unsupported_value','calibration_type');
 },
 // Both Admin sources are SETOF jsonb. A successful array response alone does not
 // prove PostgREST delivered the entire set. Refuse totals when the cap truncates it.
 async load(caller,a,signal){
  const rpc=rpcFor[a.register];
  const {data,count,error}=await caller.rpc(rpc,{}, {count:'exact'}).range(0,999).abortSignal(signal);
  if(error||!Array.isArray(data)||!Number.isSafeInteger(count)||count<0)
   throw new AssistantError(error?.code==='42501'?'business_read_denied':'business_read_unavailable',error?.code==='42501'?403:503);
  if(count>1000||count>data.length)throw new AssistantError('business_result_limit',413);
  if(count!==data.length||data.some(row=>!row?.id)||new Set(data.map(row=>row.id)).size!==count)
   throw new AssistantError('business_read_unavailable',503);
  return data.map(row=>a.register==='schedule'?pick(row,schedule):{...pick(row,history),...pick(row.equipment_snapshot||{},equipment)});
 },
 records:(rows,a)=>!a.from?rows:rows.filter(row=>{
  const when=a.register==='schedule'?row.next_due:row.calibrated_date;
  return when&&when>=a.from&&when<=a.to;
 }),
 fields:[...new Set([...schedule,...history])],
 filters:{equipment:['equipment_code','equipment_name'],location:['location_name'],status:['status'],result:['result'],calibration_type:['calibration_type']},
 sortBy:[{key:'next_due'},{key:'calibrated_date',descending:true},{key:'id'}],
 metric:{unit:'calibration requirements or records',definition:'Each matching current requirement counts once in schedule. Each retained calibration record counts once in history. Date, equipment, status and location filters precede the count.',time:'Schedule status is current in Malaysia; history uses the recorded calibration date.'},
 decorate:(_data,a)=>({register:a.register,evidence_rpc:rpcFor[a.register],date_basis:a.register==='schedule'?'next_due':'calibrated_date',
  source_limit:1000,limits:'Source snapshot must be complete. Staff, provider, notes, attachments and raw equipment snapshots are excluded.'}),
});
