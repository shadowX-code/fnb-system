import {useEffect,useRef,useState} from 'react';
import {Controls,ReactFlow} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {inboxService} from './inboxService.js';
import {marketingService} from './marketingService.js';
import {flowTypes,flowChannels,flowPorts,newFlow,insertFlowStep,removeFlowStep,flowIssues,flowTurn,flowLayout} from './aiFlowDefinition.js';

const labels={trigger:'Intent trigger',ask:'Ask / collect',condition:'Condition',knowledge:'Knowledge lookup',reply:'Reply / explain',handoff:'Human handoff',end:'Complete flow',facebook:'Messenger',instagram:'Instagram',whatsapp:'WhatsApp'};
function Field({label,value,onChange,maxLength=300}){
 return <AdminFormField label={label}><input className="control" value={value} maxLength={maxLength} onChange={event=>onChange(event.target.value)}/></AdminFormField>;
}

export default function AIFlowsPage(){
 const auth=useAuth();
 const [brands,setBrands]=useState([]),[brand,setBrand]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;
  marketingService.context().then(context=>{if(live){setBrands(context.brands);setBrand(context.brands[0]?.id||'');}})
   .catch(failure=>{if(live)setError(failure.message);});
  return()=>{live=false;};
 },[auth.user?.id]);
 const scope=brands.find(item=>item.id===brand);
 return <WorkspacePage section="Marketing" title="AI Flows" description="Build conversation flows and test how they guide a customer."
  controls={<SelectField label="Brand" value={brand} onChange={setBrand} options={brands.map(item=>({value:item.id,label:item.name}))}/>}>
  {error?<p role="alert">{error}</p>:null}
  {scope?<FlowWorkspace key={`${auth.user?.id}:${brand}`} scope={scope} canEdit={auth.hasPermission('marketing_campaigns.manage')} canGenerate={auth.hasPermission('marketing_inbox.ai')} canExecute={auth.hasPermission('marketing_campaigns.execute')}/>:null}
 </WorkspacePage>;
}

function FlowWorkspace({scope,canEdit,canGenerate,canExecute}){
 const [library,setLibrary]=useState([]),[record,setRecord]=useState(null),[flow,setFlow]=useState(null);
 const [selected,setSelected]=useState('trigger'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [test,setTest]=useState(null),[answer,setAnswer]=useState(''),[mode,setMode]=useState('suggest_only');
 const [knowledge,setKnowledge]=useState(null);
 const pendingSave=useRef(null);
 const [prompt,setPrompt]=useState(null);
 const generation=useRef(null);
 const [versions,setVersions]=useState(null),[testInputs,setTestInputs]=useState([]);
 const org=scope.organization_id,brand=scope.id;
 useEffect(()=>{
  let live=true;
  marketingService.aiFlows(org,brand).then(rows=>{if(live)setLibrary(rows);}).catch(failure=>{if(live)setError(failure.message);});
  return()=>{live=false;};
 },[org,brand]);
 function open(item){
  setRecord(item);setFlow(item?.definition||newFlow());setSelected('trigger');setVersions(null);setTestInputs([]);setTest(null);setKnowledge(null);setAnswer('');setError('');
 }
 const issues=flow?flowIssues(flow):{};
 const dirty=Boolean(flow&&record&&JSON.stringify(flow)!==JSON.stringify(record.definition));
 const node=flow?.nodes.find(item=>item.id===selected);
 const positions=flow?flowLayout(flow.nodes):[];
 function update(patch){setFlow(current=>({...current,...patch}));setTest(null);setKnowledge(null);}
 function updateNode(patch){update({nodes:flow.nodes.map(item=>item.id===selected?{...item,...patch}:item)});}
 async function save(){
  if(!canEdit||busy||Object.keys(issues).length)return;
  const fingerprint=JSON.stringify([record?.id,record?.version,flow]);
  if(pendingSave.current?.fingerprint!==fingerprint)pendingSave.current={fingerprint,id:crypto.randomUUID()};
  setBusy(true);setError('');
  try{
   const saved=await marketingService.saveAIFlow(org,brand,record?.id||null,record?.version||0,flow,pendingSave.current.id);
   pendingSave.current=null;
   open(saved);
   setLibrary(await marketingService.aiFlows(org,brand));
  }catch(failure){setError(failure.message);}
  finally{setBusy(false);}
 }
 async function generate(event){
  event.preventDefault();
  if(busy||!canEdit||!canGenerate||prompt.trim().length<10)return;
  const description=prompt.trim();
  if(generation.current?.description!==description)generation.current={description,id:crypto.randomUUID()};
  setBusy(true);setError('');
  try{
   const result=await inboxService.generateFlow({requestId:generation.current.id,org,brand,description});
   if(result.state!=='completed'||!result.definition)throw new Error('Generation did not return a draft. Change the description or start a new request.');
   open(null);setFlow(result.definition);setPrompt(null);
  }catch(failure){setError(failure.message);}
  finally{generation.current=null;setBusy(false);}
 }
 async function continueTest(event){
  event.preventDefault();
  if(busy)return;
  if(test.status==='knowledge'){
   if(!answer.trim())return;
   setBusy(true);setError('');
   try{
    const result=await inboxService.testAI({
     requestId:crypto.randomUUID(),org,brand,mode,
     history:[{kind:'incoming',text:answer.trim()}],
    });
    if(result.state!=='completed'||!result.result)throw new Error('Knowledge test did not complete. Review AI readiness and try again.');
    setKnowledge(result.result);
    if(result.result.decision.kind==='handoff'){
     setTest({...test,status:'handoff',text:'The knowledge engine would hand this question to staff.'});
     return;
    }
   }catch(failure){setError(failure.message);return;}
   finally{setBusy(false);}
  }
  const next=flowTurn(flow,test,test.status==='collect'?answer:'');
  if(test.status==='collect'&&next.step!==test.step)setTestInputs(values=>[...values,answer.trim().slice(0,500)]);
  setTest(next);setAnswer('');
 }
 async function lifecycle(action,version){
  if(busy||!record)return;
  setBusy(true);setError('');
  try{
   if(action==='history'){setVersions(await marketingService.aiFlowVersions(org,brand,record.id));return;}
   if(action==='certify')await marketingService.certifyAIFlow(org,brand,record.id,record.version,testInputs);
   else await marketingService.setAIFlowState(org,brand,record.id,version,action);
   const rows=await marketingService.aiFlows(org,brand);
   setLibrary(rows);
   setRecord(rows.find(item=>item.id===record.id)||record);
   if(versions)setVersions(await marketingService.aiFlowVersions(org,brand,record.id));
  }catch(failure){setError(failure.message);}
  finally{setBusy(false);}
 }
 return <div className="space-y-4">
  {error?<p role="alert" className="text-danger">{error}</p>:null}
  <div className="card space-y-3 p-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h2>Flow Library</h2>{canEdit?<button type="button" className="btn-primary" disabled={busy} onClick={()=>open(null)}>Build manually</button>:null}</div>
   {canEdit&&canGenerate?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>setPrompt('')}>Create with AI</button>:null}
   {prompt!==null?<form className="space-y-2" onSubmit={generate}>
    <AdminFormField label="Describe the flow"><textarea className="control" rows={3} maxLength={1500} value={prompt} disabled={busy} onChange={event=>setPrompt(event.target.value)}/></AdminFormField>
    <p>Use fictional examples. Review the generated draft before saving.</p>
    <div className="flex gap-2"><button type="submit" className="btn-primary" disabled={busy||prompt.trim().length<10}>{busy?'Generating…':'Generate draft'}</button>
     <button type="button" className="btn-secondary" disabled={busy} onClick={()=>setPrompt(null)}>Cancel</button></div>
   </form>:null}
   {library.length?<ul className="flex flex-wrap gap-2">{library.map(item=><li key={item.id}><button type="button" className="btn-secondary" disabled={busy} onClick={()=>open(item)}>{item.definition.name} · v{item.version}{item.active_version&&!item.paused?` · Active v${item.active_version}`:item.active_version?' · Paused':item.ready?' · Ready':' · Draft'}</button></li>)}</ul>:<p className="text-sm">Saved drafts appear here for this Brand.</p>}
  </div>
  {record?<section className="card space-y-3 p-4" aria-label="Flow lifecycle">
   <p className="text-sm">Version controls are available for testing. Live conversation routing is unavailable.</p>
   <p>{record.ready?'Ready':'Draft'} v{record.version}{record.active_version?` · ${record.paused?'Paused':'Active'} v${record.active_version}`:''}</p>
   <div className="flex flex-wrap gap-2">
    <button type="button" className="btn-secondary" disabled={busy} onClick={()=>lifecycle('history')}>Version history</button>
    {canExecute&&record.ready&&!dirty&&(record.paused||record.active_version!==record.version)?<button type="button" className="btn-primary" disabled={busy} onClick={()=>lifecycle('activate',record.version)}>Activate version</button>:null}
    {canExecute&&record.active_version&&!record.paused?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>lifecycle('pause',record.active_version)}>Pause flow</button>:null}
   </div>
   {versions?<ul className="space-y-2">{versions.map(item=><li key={item.version} className="flex flex-wrap gap-2">
    <span>Version {item.version} · {item.definition.name} · {item.ready?'Ready':'Draft'}</span>
    {canExecute&&item.ready&&item.version!==record.active_version?<button type="button" className="btn-secondary" disabled={busy||dirty} onClick={()=>lifecycle('rollback',item.version)}>Restore v{item.version}</button>:null}
   </li>)}</ul>:null}
  </section>:null}
  {flow&&node?<div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
   <section className="card min-w-0 space-y-3 p-4" aria-label="Flow canvas">
    <div className="flex items-center justify-between gap-2"><h2>{flow.name||'Untitled flow'}</h2><Badge>Draft</Badge></div>
    <div className="hidden h-[480px] overflow-hidden rounded-lg border md:block">
     <ReactFlow fitView nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null}
      nodes={flow.nodes.map((item,index)=>({id:item.id,position:positions[index],selected:item.id===selected,
       data:{label:`${issues[item.id]?'⚠ ':''}${labels[item.type]}${item.field?' · '+item.field:''}`}}))}
      edges={flow.nodes.flatMap(item=>flowPorts(item).map(port=>({id:`${item.id}:${port}`,source:item.id,target:item[port],
       label:port==='next'?undefined:port==='yes'?'Yes':'No',markerEnd:{type:'arrowclosed'}})))}
      onNodeClick={(_event,item)=>setSelected(item.id)}><Controls showInteractive={false}/></ReactFlow>
    </div>
    <SelectField label="Edit step" value={selected} onChange={setSelected} options={flow.nodes.map((item,index)=>({value:item.id,label:`${index+1}. ${labels[item.type]}`}))}/>
    <div className="flex flex-wrap gap-2">
     {canEdit&&flowPorts(node).map(port=><SelectField key={`${selected}:${port}`} label={port==='next'?'Insert next step':`Insert on ${port} branch`}
      value="" disabled={busy} onChange={type=>{if(type)update(insertFlowStep(flow,selected,port,type));}}
      options={[{value:'',label:'＋ Add step'},...flowTypes.map(type=>({value:type,label:labels[type]}))]}/>)}
    </div>
   </section>
   <section className="card min-w-0 space-y-3 p-4" aria-label="Step inspector">
    <h2>{labels[node.type]}</h2>
    <fieldset className="space-y-3" disabled={!canEdit||busy}>
     {node.type==='trigger'?<>
      <Field label="Flow name" value={flow.name} maxLength={120} onChange={name=>update({name})}/>
      <Field label="Description" value={flow.description} onChange={description=>update({description})}/>
      <Field label="Objective" value={flow.objective} onChange={objective=>update({objective})}/>
      <Field label="Customer intent" value={flow.intent} onChange={intent=>update({intent})}/>
      <AdminFormField label="Trigger examples"><textarea className="control" rows={3} maxLength={3000} value={flow.examples.join('\n')} onChange={event=>update({examples:event.target.value.split('\n')})}/></AdminFormField>
      {flowChannels.map(channel=><label className="flex items-center gap-2" key={channel}><input type="checkbox" checked={flow.channels.includes(channel)}
       onChange={event=>update({channels:event.target.checked?[...flow.channels,channel]:flow.channels.filter(value=>value!==channel)})}/>{labels[channel]}</label>)}
     </>:null}
     {['ask','condition'].includes(node.type)?<Field label="Field key" value={node.field} maxLength={32} onChange={field=>updateNode({field})}/>:null}
     {node.type==='ask'?<>
      <SelectField label="Value type" value={node.value_type} onChange={value_type=>updateNode({value_type})} options={['text','number','boolean'].map(value=>({value,label:value}))}/>
      <label className="flex items-center gap-2"><input type="checkbox" checked={node.required} onChange={event=>updateNode({required:event.target.checked})}/>Required</label>
     </>:null}
     {node.type==='condition'?<Field label="Equals" value={node.equals} onChange={equals=>updateNode({equals})}/>:null}
     {['ask','reply','handoff'].includes(node.type)?<Field label={node.type==='ask'?'Question':'Message'} value={node.prompt} onChange={prompt=>updateNode({prompt})}/>:null}
    </fieldset>
    {issues[node.id]||issues.flow?<p role="status" className="text-danger">{issues[node.id]||issues.flow}</p>:null}
    {canEdit?<div className="flex flex-wrap gap-2">
     <button type="button" className="btn-primary" disabled={busy||Object.keys(issues).length>0} onClick={save}>Save draft</button>
     {node.type!=='trigger'&&flowPorts(node).map(port=><button type="button" key={port} disabled={busy} className="btn-secondary"
      onClick={()=>{update(removeFlowStep(flow,selected,port));setSelected('trigger');}}>
      {port==='next'?'Remove step':`Remove condition, keep ${port==='yes'?'Yes':'No'}`}
     </button>)}
    </div>:null}
   </section>
   <section className="card space-y-3 p-4 lg:col-span-2" aria-label="Test flow">
    <div className="flex items-center justify-between gap-2"><h2>Test Flow</h2><Badge>Simulation only</Badge></div>
    <p>Try the selected flow with fictional details. Collection and branching run in the browser. Knowledge tests use the Brand’s existing AI test service.</p>
    <SelectField label="Simulated AI mode" value={mode} onChange={setMode} disabled={busy} options={[
     {value:'suggest_only',label:'Suggest Only'},{value:'safe_auto',label:'Safe Auto Reply'},{value:'ai_first',label:'AI First'},
    ]}/>
    <button type="button" className="btn-secondary" disabled={busy||Object.keys(issues).length>0} onClick={()=>{setTest(flowTurn(flow));setTestInputs([]);setKnowledge(null);setAnswer('');}}>Start test</button>
    {test?<><p role="status">{test.text||({completed:'Flow completed',knowledge:'Knowledge lookup step',handoff:'Human handoff'}[test.status]||test.status)}</p>
     <p>Steps in this turn · {test.trace.map(id=>labels[flow.nodes.find(step=>step.id===id)?.type]).join(' → ')}</p>
     <p>{Object.entries(test.fields).map(([field,value])=>`${field}: ${value}`).join(' · ')}</p>
     {['collect','reply','knowledge'].includes(test.status)?<form className="flex flex-wrap items-end gap-2" onSubmit={continueTest}>
      {test.status==='collect'||test.status==='knowledge'?<Field label={test.status==='collect'?'Customer answer':'Customer question for Knowledge'} value={answer} onChange={setAnswer}/>:null}<button type="submit" className="btn-secondary" disabled={busy}>Continue test</button>
     </form>:null}</>:null}
    {record&&canEdit&&!dirty&&!record.ready&&['completed','handoff'].includes(test?.status)&&!knowledge?
     <button type="button" className="btn-secondary" disabled={busy} onClick={()=>lifecycle('certify')}>Record successful simulation</button>:null}
    {knowledge?<div className="space-y-2" aria-label="Knowledge test evidence">
     <p>{knowledge.decision.text||knowledge.body.text}</p>
     {knowledge.body.sources?.map(source=><p key={source.key}>{source.label}</p>)}
     {knowledge.body.unresolved_questions?.map(question=><p key={question}>{question}</p>)}
     <p>{knowledge.input_tokens??'—'} input · {knowledge.output_tokens??'—'} output · {knowledge.latency_ms??'—'} ms · {knowledge.estimated_cost_usd==null?'Cost unavailable':`US$${Number(knowledge.estimated_cost_usd).toFixed(6)} estimated`}</p>
    </div>:null}
   </section>
  </div>:null}
 </div>;
}
