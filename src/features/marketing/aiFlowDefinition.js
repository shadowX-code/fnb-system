export const flowTypes = ['ask','condition','knowledge','reply','handoff','end'];
export const flowChannels = ['facebook','instagram','whatsapp'];
const terminal = node => ['handoff','end'].includes(node.type);
export const flowPorts = node => terminal(node) ? [] : node.type === 'condition' ? ['yes','no'] : ['next'];

export function newFlow() {
 return {name:'',description:'',objective:'',channels:[],intent:'',examples:[],
  nodes:[{id:'trigger',type:'trigger',next:'end'},{id:'end',type:'end'}]};
}

export function insertFlowStep(definition, id, port, type) {
 const index=definition.nodes.findIndex(node=>node.id===id);
 const source=definition.nodes[index];
 const target=source?.[port];
 if(!flowTypes.includes(type)||!source||!flowPorts(source).includes(port)||!target||definition.nodes.length>=40) return definition;
 const node={id:crypto.randomUUID(),type};
 if(type==='condition')Object.assign(node,{field:'',equals:'',yes:target,no:target});
 else if(!terminal(node))node.next=target;
 if(type==='ask')Object.assign(node,{field:'',prompt:'',value_type:'text',required:true});
 if(type==='reply'||type==='handoff')node.prompt='';
 const nodes=[...definition.nodes];
 nodes[index]={...source,[port]:node.id};
 nodes.splice(index+1,0,node);
 return {...definition,nodes:reachableSteps(nodes)};
}

function reachableSteps(nodes){
 const reachable=new Set(['trigger']);
 for(const step of nodes)if(reachable.has(step.id))for(const edge of flowPorts(step))reachable.add(step[edge]);
 return nodes.filter(step=>reachable.has(step.id));
}

export function removeFlowStep(definition,id,keepPort){
 const step=definition.nodes.find(node=>node.id===id);
 if(!step||step.type==='trigger'||!flowPorts(step).includes(keepPort))return definition;
 const target=step[keepPort];
 const nodes=definition.nodes.filter(node=>node.id!==id).map(node=>{
  const ports=flowPorts(node).filter(port=>node[port]===id);
  return ports.length?{...node,...Object.fromEntries(ports.map(port=>[port,target]))}:node;
 });
 return {...definition,nodes:reachableSteps(nodes)};
}

export function flowIssues(flow) {
 const errors={};
 if(!flow.name.trim()||!flow.intent.trim()||!flow.channels.length)errors.flow='Add a name, intent and channel.';
 const fields=new Set();
 for(const [index,node] of flow.nodes.entries()){
  if(flowPorts(node).some(port=>flow.nodes.findIndex(step=>step.id===node[port])<=index))errors[node.id]='Connect every step to a later step.';
  if(node.type==='ask'){
   if(!/^[a-z][a-z0-9_]{0,31}$/.test(node.field)||fields.has(node.field)||!node.prompt.trim())errors[node.id]='Enter a unique field key and a question.';
   fields.add(node.field);
  }
  if(node.type==='condition'&&(!fields.has(node.field)||!node.equals.trim()))errors[node.id]='Choose a collected field and a comparison value.';
  if(['reply','handoff'].includes(node.type)&&!node.prompt.trim())errors[node.id]='Enter a message.';
 }
 return errors;
}

export function flowTurn(definition, previous, answer) {
 const state={step:previous?.step||'trigger',fields:{...previous?.fields},trace:[],status:'running'};
 const value=answer?.trim()||'';
 for(let count=0;count<definition.nodes.length;count++){
  const node=definition.nodes.find(step=>step.id===state.step);
  if(!node)return {...state,status:'invalid'};
  state.trace.push(node.id);
  if(terminal(node))return {...state,status:node.type==='end'?'completed':'handoff',text:node.prompt||''};
  if(node.type==='knowledge')return {...state,status:'knowledge',step:node.next};
  if(node.type==='reply')return {...state,status:'reply',step:node.next,text:node.prompt};
  if(node.type==='ask'&&!Object.hasOwn(state.fields,node.field)){
   if(previous?.step!==node.id||!value)return {...state,status:'collect',text:node.prompt};
   if(value==='-'&&!node.required)state.fields[node.field]='';
   else if(node.value_type==='number'&&!/^-?\d+(\.\d+)?$/.test(value))return {...state,status:'collect',text:'Enter a number. '+node.prompt};
   else if(node.value_type==='boolean'&&!/^(yes|no)$/i.test(value))return {...state,status:'collect',text:'Enter yes or no. '+node.prompt};
   else state.fields[node.field]=value.slice(0,500);
  }
  state.step=node.type==='condition'?(String(state.fields[node.field]??'').toLowerCase()===node.equals.toLowerCase()?node.yes:node.no):node.next;
 }
 return {...state,status:'invalid'};
}

export function flowLayout(nodes) {
 const depth=new Map([['trigger',0]]);
 const rows=new Map();
 return nodes.map(node=>{
  const level=depth.get(node.id)||0;
  for(const port of flowPorts(node))depth.set(node[port],Math.max(depth.get(node[port])||0,level+1));
  const row=rows.get(level)||0;
  rows.set(level,row+1);
  return {x:row*230,y:level*100};
 });
}
