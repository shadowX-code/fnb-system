import {collaborationStatus} from './creatorPresentation.js';
/** Apply only confirmed command results. Refresh may enrich them, never gates save acknowledgement. */
export function applyCreatorMutation(data,action,value){
 if(['save_account','archive_account'].includes(action))return {...data,accounts:[value,...data.accounts.filter(a=>a.id!==value.id)]};
 if(action==='save_collaboration'){
  return {...data,collaborations:[value,...data.collaborations.filter(c=>c.id!==value.id)],posts:data.posts};
 }
 if(['save_post','link_post'].includes(action)){
  const previous=data.posts.find(p=>p.id===value.id);
  const post={...previous,...value,latest_metrics:previous?.latest_metrics||value.public_observation?.metrics||{},snapshot_count:value.snapshot_count??previous?.snapshot_count};
  const posts=[post,...data.posts.filter(p=>p.id!==value.id)];
  return {...data,posts,collaborations:data.collaborations.map(c=>({...c,workflow_status:c.workflow_status??c.status,status:collaborationStatus(c,posts)}))};
 }
 return data;
}
export const immediateCreatorActions=new Set(['save_account','archive_account','save_collaboration','save_post','link_post']);
