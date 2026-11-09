import {useEffect,useRef,useState} from 'react';
import {Background,BaseEdge,Controls,EdgeLabelRenderer,Handle,MarkerType,Position,ReactFlow,getSmoothStepPath} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {ArrowLeft, CircleCheck, GitBranch, ListFilter, MessageCircle, Plus, Search, Settings2, Sparkles, TriangleAlert, UserRound, Workflow} from 'lucide-react';
import Modal from '../../components/feedback/Modal.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import './aiFlows.css';
import {formatOperationalDateTime} from '../../lib/dateTime.js';
import {useAuth} from '../../auth/AuthContext.jsx';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFormField from '../../components/forms/AdminFormField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import Badge from '../../components/ui/Badge.jsx';
import {inboxService} from './inboxService.js';
import {marketingService} from './marketingService.js';
import {flowTypes,flowChannels,flowPorts,newFlow,insertFlowStep,removeFlowStep,flowIssues,flowTurn,flowLayout,simulateWhatsAppInbound} from './aiFlowDefinition.js';

const labels={trigger:'Intent trigger',ask:'Ask / collect',condition:'Condition',knowledge:'Knowledge lookup',reply:'Reply / explain',handoff:'Human handoff',end:'Complete flow',facebook:'Messenger',instagram:'Instagram',whatsapp:'WhatsApp'};
const stepIcons={trigger:Workflow,ask:ListFilter,condition:GitBranch,knowledge:Search,reply:MessageCircle,handoff:UserRound,end:CircleCheck};
function stepSummary(step){
 return step.prompt|| (step.type==='condition'&&step.field?`${step.field} equals ${step.equals||'…'}`:null)
  || ({trigger:'Match a customer intent',ask:'Choose a field and question',knowledge:'Look up approved Brand knowledge',handoff:'Pass to the team',end:'Finish the conversation flow'}[step.type]||'Configure this step');
}
function FlowNode({data,selected}){
 const {step,error,running}=data, Icon=stepIcons[step.type];
 return <div className={`af-node${selected?' is-selected':''}${running?' is-running':''}${error?' has-error':''}`}>
  {step.type!=='trigger'?<Handle type="target" position={Position.Top}/>:null}
  <Icon size={16} aria-hidden="true"/>
  <div><strong>{labels[step.type]}</strong><small>{stepSummary(step)}</small></div>
  {error?<span title={error} aria-label={error}><TriangleAlert size={15}/></span>:running?<span className="af-current">Testing</span>:null}
  {flowPorts(step).map(port=><Handle key={port} id={port} type="source" position={Position.Bottom}
   style={{left:port==='yes'?'35%':port==='no'?'65%':'50%'}}/>)}
 </div>;
}
function FlowEdge({id,sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,markerEnd,data}){
 const [path,x,y]=getSmoothStepPath({sourceX,sourceY,targetX,targetY,sourcePosition,targetPosition,borderRadius:10});
 return <><BaseEdge id={id} path={path} markerEnd={markerEnd}/>
  {(data.label||data.insert)?<EdgeLabelRenderer><div className="af-edge-label nodrag nopan" style={{transform:`translate(-50%, -50%) translate(${x}px,${y}px)`}}>
   {data.label?<span>{data.label}</span>:null}
   {data.insert?<button type="button" aria-label={`Insert step after ${data.sourceLabel}${data.label?`, ${data.label} branch`:''}`} onClick={data.insert}><Plus size={13}/></button>:null}
  </div></EdgeLabelRenderer>:null}
 </>;
}
const nodeTypes={flow:FlowNode},edgeTypes={flow:FlowEdge};
function flowStatus(record){
 if(record?.active_version&&!record.paused)return `Active v${record.active_version}`;
 if(record?.active_version)return 'Paused';
 return record?.ready?'Ready':'Draft';
}
function Field({label,value,onChange,maxLength=300}){
 return <AdminFormField label={label}><input className="control" value={value} maxLength={maxLength} onChange={event=>onChange(event.target.value)}/></AdminFormField>;
}

export default function AIFlowsPage(){
 const auth=useAuth();
 const [brands,setBrands]=useState(null),[brand,setBrand]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
  let live=true;
  marketingService.context().then(context=>{if(live){setBrands(context.brands);setBrand(context.brands[0]?.id||'');}})
   .catch(failure=>{if(live)setError(failure.message);});
  return()=>{live=false;};
 },[auth.user?.id]);
 const scope=brands?.find(item=>item.id===brand);
 if(!scope)return <WorkspacePage section="Marketing" title="AI Flows">
  {error?<p role="alert">{error}</p>:<p role="status">{brands?'No accessible Brands.':'Loading Brands…'}</p>}
 </WorkspacePage>;
 return <FlowWorkspace key={`${auth.user?.id}:${brand}`} scope={scope} brands={brands} onBrandChange={setBrand}
  canEdit={auth.hasPermission('marketing_campaigns.manage')} canGenerate={auth.hasPermission('marketing_inbox.ai')}
  canExecute={auth.hasPermission('marketing_campaigns.execute')}/>;
}

function FlowWorkspace({scope,brands,onBrandChange,canEdit,canGenerate,canExecute}){
 const [library,setLibrary]=useState(null),[record,setRecord]=useState(null),[flow,setFlow]=useState(null);
 const [selected,setSelected]=useState('trigger'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [test,setTest]=useState(null),[answer,setAnswer]=useState(''),[mode,setMode]=useState('suggest_only');
 const [knowledge,setKnowledge]=useState(null);
 const pendingSave=useRef(null);
 const [designer,setDesigner]=useState(false),[designerMessages,setDesignerMessages]=useState([]);
 const [prompt,setPrompt]=useState(''),[proposal,setProposal]=useState(null),[undo,setUndo]=useState(null);
 const [showInspector,setShowInspector]=useState(true);
 const generation=useRef(false),designerEnd=useRef(null),designerRequest=useRef(null);
 const [designerNotice,setDesignerNotice]=useState(null);
 useEffect(()=>{if(designerMessages.length)designerEnd.current?.scrollIntoView({block:'nearest'});},[designerMessages.length]);
 const [search,setSearch]=useState(''),[newOpen,setNewOpen]=useState(false),[panel,setPanel]=useState('node');
 const [palette,setPalette]=useState(null),[baseline,setBaseline]=useState(null),[chat,setChat]=useState([]);
 const [reload,setReload]=useState(0),[libraryError,setLibraryError]=useState('');
 const [inbound,setInbound]=useState('');
 const [versions,setVersions]=useState(null),[testInputs,setTestInputs]=useState([]);
 const org=scope.organization_id,brand=scope.id;
 const sample=flow?.channels.includes('whatsapp')?inbound.trim():'';
 useEffect(()=>{
  let live=true;
  setLibraryError('');
  marketingService.aiFlows(org,brand).then(rows=>{if(live)setLibrary(rows);}).catch(failure=>{if(live)setLibraryError(failure.message);});
  return()=>{live=false;};
 },[org,brand,reload]);
 function open(item,definition=item?.definition||newFlow()){
  setRecord(item);setFlow(definition);setBaseline(item?.definition||newFlow());setSelected('trigger');setPanel(item?'node':'settings');
  designerRequest.current=null;setDesignerNotice(null);
  setDesigner(false);setDesignerMessages([]);setPrompt('');setProposal(null);setUndo(null);setShowInspector(true);
  setPalette(null);setVersions(null);setTestInputs([]);setTest(null);setChat([]);setKnowledge(null);setAnswer('');setError('');setNewOpen(false);setInbound('');
 }
 const issues=flow?flowIssues(flow):{};
 const dirty=Boolean(flow&&JSON.stringify(flow)!==JSON.stringify(baseline));
 useEffect(()=>{
  if(!dirty)return;
  const warn=event=>{event.preventDefault();event.returnValue='';};
  const guardRoute=event=>{
   if(event.destination.sameDocument&&event.cancelable&&new URL(event.destination.url).pathname!==window.location.pathname
    &&!window.confirm('Discard unsaved changes to this flow?'))event.preventDefault();
  };
  window.addEventListener('beforeunload',warn);
  window.navigation?.addEventListener('navigate',guardRoute);
  return()=>{
   window.removeEventListener('beforeunload',warn);
   window.navigation?.removeEventListener('navigate',guardRoute);
  };
 },[dirty]);
 function back(){
  if(busy||(dirty&&!window.confirm('Discard unsaved changes to this flow?')))return;
  setFlow(null);setError('');
 }
 function pick(id){setSelected(id);setPalette(null);setPanel('node');setShowInspector(true);}
 function addStep(type){
  const next=insertFlowStep(flow,palette.id,palette.port,type);
  if(next===flow)return;
  const inserted=next.nodes.find(step=>step.id===palette.id)?.[palette.port];
  update(next);pick(inserted);setPanel('node');
 }
 const node=flow?.nodes.find(item=>item.id===selected);
 const positions=flow?flowLayout(flow.nodes):[];
 function update(patch){setFlow(current=>({...current,...patch}));setTest(null);setChat([]);setKnowledge(null);}
 function updateNode(patch){update({nodes:flow.nodes.map(item=>item.id===selected?{...item,...patch}:item)});}
 async function save(){
  if(!canEdit||busy||Object.keys(issues).length)return;
  const fingerprint=JSON.stringify([record?.id,record?.version,flow]);
  if(pendingSave.current?.fingerprint!==fingerprint)pendingSave.current={fingerprint,id:crypto.randomUUID()};
  setBusy(true);setError('');
  try{
   const saved=await marketingService.saveAIFlow(org,brand,record?.id||null,record?.version||0,flow,pendingSave.current.id);
   pendingSave.current=null;
   setRecord({...record,...saved,ready:false});setBaseline(saved.definition);setFlow(saved.definition);setTest(null);setChat([]);
   setLibrary(rows=>[{...record,...saved,ready:false},...(rows||[]).filter(item=>item.id!==saved.id)]);
  }catch(failure){setError(failure.message);}
  finally{setBusy(false);}
 }
 function openDesigner(){
  open(null);
  setDesigner(true);setShowInspector(false);
 }
 async function generate(description){
  description=description.trim();
  if(busy||generation.current||proposal||!canEdit||!canGenerate||description.length<2)return;
  const draft=record||dirty?flow:null;
  generation.current=true;setBusy(true);setError('');setDesignerNotice(null);setPrompt(description);
  const request={org,brand,designer:true,description,draft,selected,
   history:designerMessages.slice(-10).map(({role,text})=>({role,text:text.slice(0,1200)}))};
  const key=JSON.stringify(request);
  if(designerRequest.current?.key!==key)designerRequest.current={key,id:crypto.randomUUID()};
  try{
   const result=await inboxService.generateFlow({...request,requestId:designerRequest.current.id});
   if(result.state==='quota'||result.state==='in_progress'){
    const messages={cooldown:'Please wait a moment before sending another request.',actor_turns:'You reached your Designer limit for completed turns.',actor_attempts:'You reached your Designer limit for attempts.',organization_attempts:'Your workspace reached its Designer limit.',project_attempts:'The Designer reached its shared usage limit.'};
    setDesignerNotice({message:result.state==='in_progress'?'A Designer request is still pending.':messages[result.reason]||'The Designer limit was reached.',retryAt:result.retry_at});
    return;
   }
   designerRequest.current=null;
   if(result.state!=='completed'||!result.message)throw new Error(result.error||'The Designer did not return a response. Try again.');
   setPrompt('');
   setDesignerMessages(items=>[...items,{role:'manager',text:description},{role:'designer',text:result.message,choices:result.choices||[]}]);
   if(result.kind==='proposal'&&result.definition)setProposal({definition:result.definition,base:flow});
  }catch(failure){setDesignerNotice({message:failure.message});}
  finally{generation.current=false;setBusy(false);}
 }
 function applyProposal(){
  if(!proposal||busy)return;
  if(flow!==proposal.base){setError('The canvas changed during review. Ask the Designer to update its proposal.');setProposal(null);return;}
  setUndo({before:flow,after:proposal.definition});
  setFlow(proposal.definition);setTest(null);setChat([]);setKnowledge(null);
  if(!proposal.definition.nodes.some(step=>step.id===selected))setSelected('trigger');
  setProposal(null);
  setDesignerMessages(items=>[...items,{role:'designer',text:'Changes applied to the canvas. Save the draft when you are ready.'}]);
 }
 async function continueTest(event){
  event.preventDefault();
  if(busy)return;
  if(test.status==='knowledge'){
   if(!answer.trim())return;
   setBusy(true);setError('');
   try{
    const result=await inboxService.testAI({
     requestId:crypto.randomUUID(),org,brand,mode:sample?'suggest_only':mode,
     history:[{kind:'incoming',text:answer.trim()}],
    });
    if(result.state!=='completed'||!result.result)throw new Error('Knowledge test did not complete. Review AI readiness and try again.');
    setKnowledge(result.result);
    setChat(items=>[...items,{role:'customer',text:answer.trim()},{role:'flow',text:result.result.decision.text||result.result.body.text}]);
    if(result.result.decision.kind==='handoff'){
     setTest({...test,status:'handoff',text:'The knowledge engine would hand this question to staff.'});
     return;
    }
   }catch(failure){setError(failure.message);return;}
   finally{setBusy(false);}
  }
  const next=flowTurn(flow,test,test.status==='collect'?answer:'');
  if(test.status==='collect'&&next.step!==test.step)setTestInputs(values=>[...values,answer.trim().slice(0,500)]);
  setChat(items=>[...items,...(test.status==='collect'&&answer.trim()?[{role:'customer',text:answer.trim()}]:[]),flowMessage(next)]);
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
 function flowMessage(state){
  return {role:'flow',text:state.text||({completed:'Flow completed',knowledge:'Ready for a knowledge question.',handoff:'Handoff to staff'}[state.status]||'Continue to the next step.')};
 }
 function startTest(){
  const state=sample?simulateWhatsAppInbound(flow,sample):flowTurn(flow);
  setTest(state);setChat([...(sample?[{role:'customer',text:sample}]:[]),flowMessage(state)]);setTestInputs([]);setKnowledge(null);setAnswer('');
 }
 const errorMessage=error?<p role="alert" className="af-feedback">{error}</p>:null;
 if(!flow){
  const query=search.trim().toLowerCase();
  const visible=(library||[]).filter(item=>[item.definition.name,item.definition.description,flowStatus(item),...item.definition.channels.map(channel=>labels[channel])].some(value=>(value||'').toLowerCase().includes(query)));
  return <WorkspacePage section="Marketing" title="AI Flows" description="Design and test conversation flows for your Brand."
   actions={canEdit?<button type="button" className="btn-primary" onClick={()=>setNewOpen(true)}><Plus size={16}/> New Flow</button>:null}>
   <section className="af-library" aria-label="Flow Library">
    <div className="af-library-tools">
     <div><h2>Flow Library</h2><p>{library?`${library.length} ${library.length===1?'flow':'flows'}`:'Loading flows…'}</p></div>
     <SelectField label="Brand" value={brand} onChange={onBrandChange} options={brands.map(item=>({value:item.id,label:item.name}))}/>
     <AdminFormField label="Search flows"><input className="control" type="search" value={search} onChange={event=>setSearch(event.target.value)}/></AdminFormField>
    </div>
    <AsyncDataSurface loading={!library&&!libraryError} error={libraryError} hasData={Boolean(library)} onRetry={()=>setReload(value=>value+1)}>
     {library?visible.length?<div className="af-library-scroll"><table><thead><tr><th>Flow</th><th>Status</th><th>Version</th><th>Channels</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{visible.map(item=><tr key={item.id}><td><strong>{item.definition.name}</strong>{item.definition.description?<small>{item.definition.description}</small>:null}</td>
       <td><Badge>{flowStatus(item)}</Badge></td><td>v{item.version}</td><td>{item.definition.channels.map(channel=>labels[channel]).join(' · ')}</td>
       <td><button type="button" className="btn-secondary" aria-label={`${canEdit?'Edit':'Open'} ${item.definition.name}`} onClick={()=>open(item)}>{canEdit?'Edit':'Open'}</button></td></tr>)}</tbody>
     </table></div>:<div className="af-empty"><Workflow size={22}/><h3>{query?'No matching flows':'No flows yet'}</h3><p>{query?'Try a different name, status or channel.':'Use New Flow to create a conversation flow for this Brand.'}</p></div>:null}
    </AsyncDataSurface>
   </section>
   {newOpen?<Modal title="New Flow" onClose={()=>{if(!busy){setNewOpen(false);setError('');}}}>
    <div className="space-y-3">
     {errorMessage}
     <div className="af-new-options">
      {canGenerate?<button type="button" className="btn-secondary" onClick={openDesigner}><Sparkles size={18}/><span><strong>Create with AI</strong><small>Work with the Designer while you build your flow.</small></span></button>:null}
      <button type="button" className="btn-secondary" onClick={()=>open(null)}><Workflow size={18}/><span><strong>Build Manually</strong><small>Start with a trigger and add the steps you need.</small></span></button>
     </div>
    </div>
   </Modal>:null}
  </WorkspacePage>;
 }
 return <section className="af-editor" aria-label="Flow Editor">
  <header className="af-editor-header">
   <button type="button" className="btn-secondary" onClick={back} disabled={busy}><ArrowLeft size={16}/> Library</button>
   <div className="af-editor-title"><h1>{flow.name||'Untitled flow'}</h1><span>{scope.name} · {record?`v${record.version} · ${flowStatus(record)}`:'New draft'}{dirty?' · Unsaved changes':''}</span></div>
   <div className="af-editor-actions">
    {!designer&&canEdit&&canGenerate?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setDesigner(true);setShowInspector(false);}}><Sparkles size={15}/> AI Designer</button>:null}
    <button type="button" className="btn-secondary" aria-pressed={panel==='settings'} onClick={()=>{setPanel('settings');setShowInspector(true);}}><Settings2 size={15}/> Settings</button>
    {record?<button type="button" className="btn-secondary" disabled={busy} aria-pressed={panel==='versions'} onClick={()=>{setPanel('versions');setShowInspector(true);lifecycle('history');}}>Versions</button>:null}
    <button type="button" className="btn-secondary" aria-pressed={panel==='test'} onClick={()=>{setPalette(null);setShowInspector(true);setPanel(panel==='test'?'node':'test');}}><MessageCircle size={15}/> Test Flow</button>
    {canEdit?<button type="button" className="btn-primary" disabled={busy||Object.keys(issues).length>0||Boolean(record&&!dirty)} onClick={save}>Save draft</button>:null}
   </div>
  </header>
  {errorMessage}
  <div className={`af-editor-body${designer?' has-designer':''}${showInspector?' has-inspector':''}`}>
   {designer?<aside className="af-designer" aria-label="AI Designer">
    <div className="af-panel-title"><h2>AI Designer</h2><Badge>Draft only</Badge></div>
    <p className="af-muted">Describe a flow or ask for a change. Review proposals before applying them to the canvas.</p>
    <ol className="af-chat af-designer-chat" aria-label="Design conversation" aria-live="polite">
     {designerMessages.map((message,index)=><li key={index} data-role={message.role==='manager'?'customer':'flow'}>
      <strong>{message.role==='manager'?'You':'Designer'}</strong><p>{message.text}</p>
      {index===designerMessages.length-1&&message.choices?.length&&!proposal?<div className="af-designer-choices">
       {message.choices.map(choice=><button key={choice} type="button" className="btn-secondary" disabled={busy} onClick={()=>generate(choice)}>{choice}</button>)}
      </div>:null}
     </li>)}
    </ol>
    <div ref={designerEnd} aria-hidden="true"/>
    {proposal?<div className="af-designer-proposal">
     <strong>Proposed changes</strong>
     <p>{proposal.definition.name} · {proposal.definition.nodes.length} steps</p>
     <ul>{proposal.definition.nodes.filter(step=>JSON.stringify(flow.nodes.find(item=>item.id===step.id))!==JSON.stringify(step)).map(step=><li key={step.id}>{labels[step.type]} · {stepSummary(step)}</li>)}
      {flow.nodes.filter(step=>!proposal.definition.nodes.some(item=>item.id===step.id)).map(step=><li key={step.id}>Remove {labels[step.type]} · {stepSummary(step)}</li>)}</ul>
     <div className="flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={busy} onClick={applyProposal}>Apply changes</button>
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>{setProposal(null);setDesignerMessages(items=>[...items,{role:'manager',text:'I rejected that proposal.'}]);}}>Reject</button></div>
    </div>:null}
    {undo?<button type="button" className="btn-secondary" disabled={busy||flow!==undo.after} onClick={()=>{update(undo.before);setSelected('trigger');setUndo(null);}}>Undo AI changes</button>:null}
    {undo&&flow!==undo.after?<p className="af-muted">Undo is unavailable after further canvas edits.</p>:null}
    {designerNotice?<div className="af-designer-proposal" role="status">
     <p>{designerNotice.message}</p>
     {designerNotice.retryAt?<p className="af-muted">Retry time: {formatOperationalDateTime(designerNotice.retryAt)} (Malaysia time).</p>:null}
     <button type="button" className="btn-secondary" onClick={()=>{setDesigner(false);setPanel('node');setShowInspector(true);}}>Continue Manually</button>
    </div>:null}
    <form className="space-y-2" onSubmit={event=>{event.preventDefault();generate(prompt);}}>
     <AdminFormField label="Message the Designer"><textarea className="control" rows={3} value={prompt} maxLength={1200} disabled={busy||Boolean(proposal)}
      placeholder="Customer request booking from online" onChange={event=>setPrompt(event.target.value)}/></AdminFormField>
     <button type="submit" className="btn-primary" disabled={busy||Boolean(proposal)||prompt.trim().length<2}>{busy?'Working…':'Send to Designer'}</button>
    </form>
   </aside>:null}
   <section className="af-canvas" aria-label="Flow canvas">
    <div className="af-canvas-top"><span>{flow.nodes.length} steps</span>{Object.keys(issues).length?<span className="af-invalid"><TriangleAlert size={14}/> Needs configuration</span>:null}</div>
    <div className="af-graph">
     <ReactFlow fitView fitViewOptions={{maxZoom:1,padding:.2}} nodesDraggable={false} nodesConnectable={false} deleteKeyCode={null}
      nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      nodes={flow.nodes.map((step,index)=>({id:step.id,type:'flow',position:positions[index],selected:step.id===selected,
       ariaLabel:`${labels[step.type]}. ${stepSummary(step)}`,data:{step,error:issues[step.id]||(step.id==='trigger'?issues.flow:null),running:panel==='test'&&test?.trace.at(-1)===step.id}}))}
      edges={flow.nodes.flatMap(step=>flowPorts(step).map(port=>({id:`${step.id}:${port}`,source:step.id,sourceHandle:port,target:step[port],type:'flow',
       markerEnd:{type:MarkerType.ArrowClosed},data:{label:port==='next'?null:port==='yes'?'Yes':'No',sourceLabel:labels[step.type],insert:canEdit&&!busy?()=>{setSelected(step.id);setPalette({id:step.id,port});setPanel('node');setShowInspector(true);}:null}})))}
      onNodeClick={(_event,item)=>pick(item.id)} onNodesChange={changes=>{
       const selection=changes.find(change=>change.type==='select'&&change.selected);
       if(selection)pick(selection.id);
      }}>
      <Background gap={20} size={1}/><Controls showInteractive={false}/>
     </ReactFlow>
    </div>
    <ol className="af-step-list" aria-label="Flow steps">
     {flow.nodes.map(step=>{const Icon=stepIcons[step.type];return <li key={step.id}>
      <button type="button" aria-pressed={selected===step.id} aria-current={panel==='test'&&test?.trace.at(-1)===step.id?'step':undefined} onClick={()=>pick(step.id)}><Icon size={16}/><span><strong>{labels[step.type]}</strong><small>{stepSummary(step)}</small></span>
       {issues[step.id]?<TriangleAlert size={15} aria-label="Needs configuration"/>:null}</button>
     </li>;})}
    </ol>
   </section>
   {showInspector?<aside className="af-inspector" aria-label={panel==='test'?'Test Chat':'Flow inspector'}>
    {designer?<button type="button" className="btn-secondary af-hide-inspector" onClick={()=>setShowInspector(false)}>Hide panel</button>:null}
    {panel==='settings'?<><h2>Flow Settings</h2>
     <fieldset className="space-y-3" disabled={!canEdit||busy}>
      <Field label="Flow name" value={flow.name} maxLength={120} onChange={name=>update({name})}/>
      <Field label="Description" value={flow.description} onChange={description=>update({description})}/>
      <Field label="Objective" value={flow.objective} onChange={objective=>update({objective})}/>
      <Field label="Customer intent" value={flow.intent} onChange={intent=>update({intent})}/>
      <AdminFormField label="Trigger examples"><textarea className="control" rows={3} maxLength={3000} value={flow.examples.join('\n')} onChange={event=>update({examples:event.target.value.split('\n')})}/></AdminFormField>
      {flowChannels.map(channel=><label className="flex items-center gap-2" key={channel}><input type="checkbox" checked={flow.channels.includes(channel)}
       onChange={event=>update({channels:event.target.checked?[...flow.channels,channel]:flow.channels.filter(value=>value!==channel)})}/>{labels[channel]}</label>)}
     </fieldset>

      {issues.flow?<p role="status" className="af-invalid">{issues.flow}</p>:null}
    </>:null}
    {panel==='node'&&node?<><h2>{labels[node.type]}</h2><p className="af-muted">{stepSummary(node)}</p>
     <fieldset className="space-y-3" disabled={!canEdit||busy}>
     {['ask','condition'].includes(node.type)?<Field label="Field key" value={node.field} maxLength={32} onChange={field=>updateNode({field})}/>:null}
     {node.type==='ask'?<>
      <SelectField label="Value type" value={node.value_type} onChange={value_type=>updateNode({value_type})} options={['text','number','boolean'].map(value=>({value,label:value}))}/>
      <label className="flex items-center gap-2"><input type="checkbox" checked={node.required} onChange={event=>updateNode({required:event.target.checked})}/>Required</label>
     </>:null}
     {node.type==='condition'?<Field label="Equals" value={node.equals} onChange={equals=>updateNode({equals})}/>:null}
     {['ask','reply','handoff'].includes(node.type)?<Field label={node.type==='ask'?'Question':'Message'} value={node.prompt} onChange={prompt=>updateNode({prompt})}/>:null}

     </fieldset>
     {issues[node.id]?<p role="status" className="af-invalid">{issues[node.id]}</p>:null}
     {canEdit&&flowPorts(node).length?<div className="af-node-tools">
      {flowPorts(node).map(port=><button type="button" className="btn-secondary" key={port} disabled={busy}
       aria-expanded={palette?.id===node.id&&palette.port===port} onClick={()=>setPalette(palette?.id===node.id&&palette.port===port?null:{id:node.id,port})}>
       <Plus size={14}/>{port==='next'?'Add step':`Add on ${port==='yes'?'Yes':'No'}`}</button>)}
      {palette?<div className="af-palette" aria-label="Node palette">
       {flowTypes.map(type=>{const Icon=stepIcons[type];return <button type="button" key={type} disabled={busy||flow.nodes.length>=40} onClick={()=>addStep(type)}><Icon size={15}/>{labels[type]}</button>;})}
      </div>:null}
      {node.type!=='trigger'?flowPorts(node).map(port=><button type="button" key={`remove-${port}`} disabled={busy} className="btn-secondary"
       onClick={()=>{update(removeFlowStep(flow,selected,port));pick('trigger');}}>
       {port==='next'?'Remove step':`Remove condition, keep ${port==='yes'?'Yes':'No'}`}</button>):null}
     </div>:null}
    </>:null}
    {panel==='versions'&&record?<><h2>Versions</h2><p className="af-muted">Live conversation routing is unavailable. Activation here is for testing.</p>
     <div className="flex flex-wrap gap-2">
      {canExecute&&record.ready&&!dirty&&(record.paused||record.active_version!==record.version)?<button type="button" className="btn-primary" disabled={busy} onClick={()=>lifecycle('activate',record.version)}>Activate version</button>:null}
      {canExecute&&record.active_version&&!record.paused?<button type="button" className="btn-secondary" disabled={busy} onClick={()=>lifecycle('pause',record.active_version)}>Pause flow</button>:null}
     </div>
     {busy&&!versions?<p role="status">Loading versions…</p>:null}
     {versions?<ul className="af-version-list">{versions.map(item=><li key={item.version}><div><strong>Version {item.version}</strong><small>{item.definition.name} · {item.ready?'Ready':'Draft'}</small></div>
      {canExecute&&item.ready&&item.version!==record.active_version?<button type="button" className="btn-secondary" disabled={busy||dirty} onClick={()=>lifecycle('rollback',item.version)}>Restore</button>:null}</li>)}</ul>:null}
    </>:null}
    {panel==='test'?<><div className="af-panel-title"><h2>Test Chat</h2><Badge>Simulation only</Badge></div>
     <p className="af-muted">Use fictional details. Knowledge steps use the Brand’s AI test service.</p>
     {flow.channels.includes('whatsapp')?<><Field label="Fictional inbound WhatsApp message" value={inbound} onChange={value=>{setInbound(value);setTest(null);setChat([]);setKnowledge(null);}} maxLength={500}/><p className="af-muted">An exact intent or example match starts the flow in Suggest Only. Leave blank to walk through the steps directly.</p></>:null}
     <SelectField label="Simulated AI mode" value={sample?'suggest_only':mode} onChange={setMode} disabled={busy||!!sample} options={[
      {value:'suggest_only',label:'Suggest Only'},{value:'safe_auto',label:'Safe Auto Reply'},{value:'ai_first',label:'AI First'},
     ]}/>
     <button type="button" className="btn-secondary" disabled={busy||Object.keys(issues).length>0} onClick={startTest}>{test?'Restart test':'Start test'}</button>
     <ol className="af-chat" aria-label="Test messages" aria-live="polite">{chat.map((message,index)=><li key={index} data-role={message.role}><strong>{message.role==='customer'?'Customer':'Flow'}</strong><p>{message.text}</p></li>)}</ol>
     {test?<div className="af-test-details">
      <p><strong>Steps this turn</strong> {test.trace.map(id=>labels[flow.nodes.find(step=>step.id===id)?.type]).join(' → ')}</p>
      {Object.entries(test.fields).map(([field,value])=><p key={field}><strong>{field}</strong> {value}</p>)}
      {['collect','reply','knowledge'].includes(test.status)?<form className="space-y-2" onSubmit={continueTest}>
       {test.status==='collect'||test.status==='knowledge'?<Field label={test.status==='collect'?'Customer answer':'Customer question for Knowledge'} value={answer} onChange={setAnswer}/>:null}
       <button type="submit" className="btn-primary" disabled={busy}>Continue test</button>
      </form>:null}
     </div>:null}
     {record&&canEdit&&!dirty&&!record.ready&&['completed','handoff'].includes(test?.status)&&!knowledge?
      <button type="button" className="btn-secondary" disabled={busy} onClick={()=>lifecycle('certify')}>Record successful simulation</button>:null}
     {knowledge?<div className="af-test-details" aria-label="Knowledge test evidence">
      <h3>Knowledge evidence</h3>
      {knowledge.body.sources?.map(source=><p key={source.key}>{source.label}</p>)}
      {knowledge.body.unresolved_questions?.map(question=><p key={question}>{question}</p>)}
      <p>{knowledge.input_tokens??'—'} input · {knowledge.output_tokens??'—'} output · {knowledge.latency_ms??'—'} ms · {knowledge.estimated_cost_usd==null?'Cost unavailable':`US$${Number(knowledge.estimated_cost_usd).toFixed(6)} estimated`}</p>
     </div>:null}
    </>:null}
   </aside>:null}
  </div>
 </section>;
}
