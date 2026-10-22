import {useMemo,useState} from 'react';
import {History} from 'lucide-react';
import Timeline from '../../components/ui/Timeline.jsx';
import AdminSegmentedControl from '../../components/forms/AdminSegmentedControl.jsx';
import {activityRuns,plannerActivity} from './plannerActivity.js';

const PAGE=10;
export default function PlannerActivity({history=[]}){
 const [all,setAll]=useState(false),[limit,setLimit]=useState(PAGE);
 const events=useMemo(()=>plannerActivity(history),[history]);
 const filtered=all?events:events.filter(event=>event.action!=='ordered');
 const visible=filtered.slice(0,limit),runs=activityRuns(visible);
 if(!events.length)return null;
 return <details className="planner-activity"><summary><History size={16}/>Activity <span>{events.length}</span></summary>
  <div className="planner-activity-controls"><AdminSegmentedControl label="Activity view" value={all?'all':'recent'} onChange={value=>{setAll(value==='all');setLimit(PAGE)}} options={[{value:'recent',label:'Recent activity'},{value:'all',label:'All Activity'}]}/><small>{filtered.length?`${visible.length} of ${filtered.length}`:'No meaningful activity yet'}</small></div>
  {!all&&events.length>filtered.length?<p className="planner-activity-note">{events.length-filtered.length} order {events.length-filtered.length===1?'update':'updates'} in All Activity</p>:null}
  <Timeline events={runs.map(run=>run.ordered?{...run.events[0],id:`order-${run.id}`,actor:null,metadata:null,feedback:null,description:`${run.events.length} ${run.events.length===1?'event':'events'}`,actions:<details className="planner-order-activity"><summary>Show order history</summary><Timeline events={run.events} newestFirst={false} variant="activity" timeZone="Asia/Kuala_Lumpur"/></details>}:run.events[0])} newestFirst={false} variant="activity" timeZone="Asia/Kuala_Lumpur" groupByDate empty="No meaningful activity yet."/>

  {visible.length<filtered.length?<button type="button" className="btn-secondary" onClick={()=>setLimit(value=>value+PAGE)}>Load More</button>:null}
 </details>;
}
