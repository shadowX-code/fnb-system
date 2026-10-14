import {contentDay} from './contentManagement.js';
// Project canonical channel evidence into dates without collapsing partial outcomes.
export function publishingEntries(tasks,records){
 const entries=[],linked=new Set(),taskByContent=new Map(tasks.filter(t=>t.linked_content_id).map(t=>[t.linked_content_id,t]));
 for(const record of records){
  if(record.id)linked.add(record.id);
  const groups=new Map();
  for(const channel of record.channels||[]){
   const stamp=channel.actual_at||channel.scheduled_at||record.scheduled_at||record.planned_at;
   if(!stamp)continue;
   const date=contentDay(stamp);
   if(!groups.has(date))groups.set(date,[]);groups.get(date).push(channel);
  }
  if(!groups.size&&record.display_at)groups.set(contentDay(record.display_at),record.channels||[]);
  if(!groups.size&&taskByContent.get(record.id)?.planned_publish_date)groups.set(taskByContent.get(record.id).planned_publish_date,record.channels||[]);
  for(const [date,channels] of groups)entries.push({id:`content:${record.key}:${date}`,title:record.title,date,brand_id:record.brand_id,brand_name:record.brand_name,record,channels,status:record.status});
 }
 for(const task of tasks){
  if(!task.planned_publish_date||linked.has(task.linked_content_id))continue;
  entries.push({id:`task:${task.id}`,title:task.title,date:task.planned_publish_date,brand_id:task.brand_id,brand_name:task.brand_name,task,channels:[],status:task.linked_content_id?'unavailable':'planned'});
 }
 return entries;
}
