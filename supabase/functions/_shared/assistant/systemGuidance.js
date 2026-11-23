import {knowledgeQuery,knowledgeResult} from './knowledge.js';
import {validateFields} from './readContract.js';

const properties={query:knowledgeQuery};
const source='/system/ai-assistant';
const document={
 document_id:'native-assistant-user-guide',version:'1',title:'FeedX Assistant user guide',state:'current_release',current:true,
 sections:[
  {id:'history',title:'Conversation History',text:'History shows the signed-in Admin’s own saved conversations. Select a conversation to continue it. New conversation starts with fresh context. Use History to search, rename or delete a conversation.'},
  {id:'memory',title:'Personal Memory',text:'Personal Memory controls saved presentation preferences such as language, response style and recurring-work preference. Open Personal memory from the Assistant header, then save or reset the preferences. Preferences do not grant business access or provide current operational figures.'},
  {id:'voice',title:'Text and Voice',text:'Start Voice from the microphone control when Voice is available. Use End Voice before sending a text message or changing conversations. The Conversation panel shows finalized Text and Voice messages as they are saved.'},
  {id:'evidence',title:'Read evidence and AI Access',text:'Business reads apply the current user’s human permissions and AI Access policy. Open Authorized business evidence below a reply to see its source, scope and read time. Current records and documents are checked again when answering a follow-up.'},
 ],
};

export const systemGuidance={
 id:'read_assistant_system_guidance',kind:'GUIDANCE',module_id:'ai_assistant',label:'FeedX Assistant user guide',source,
 scope:'Current application guide for authenticated Admin Assistant users.',
 discoveryPhrases:['assistant user guide','assistant help','personal memory','conversation history','start voice','AI Access','workflow','business lifecycle','troubleshoot','module ownership','工作流程','aliran kerja'],
 knowledge:{type:'system_guidance',owner:'Platform',authority:'FeedX Assistant user guide',publication:'Version 1, shipped with the application.'},
 tool:{type:'function',name:'read_assistant_system_guidance',strict:true,description:'Search the current FeedX Assistant guide for History, Personal Memory, Voice controls, read evidence and AI Access. Also retrieve documented module workflows, state transitions and dependencies. For a discrepancy, use this for the rule and the authorized business READ for the observed state.',
  parameters:{type:'object',properties:{query:{type:['string','null'],maxLength:160}},required:['query'],additionalProperties:false}},
 validate:args=>validateFields(properties,args),
 async execute(_,args,signal,sessionId,workflow){
  const result=knowledgeResult(args.query,[document],{scope:{surface:'admin_assistant'}});
  if(workflow && args.query && !/^(?:history|memory|voice|evidence)$|personal memory|conversation history|start voice|end voice|AI Access/i.test(args.query)){
   const citations=await workflow(args.query);
   return {capability:systemGuidance.id,source,scope:systemGuidance.scope,as_of:new Date().toISOString(),version:1,
    knowledge:{...result.knowledge,status:citations.length?'found':'no_matching_excerpt',coverage:'bounded_excerpt_selection',citations}};
  }
  return {capability:systemGuidance.id,source,scope:systemGuidance.scope,as_of:new Date().toISOString(),version:1,
   ...result};
 },
};
