import {context,read,detail} from './fixtures.js';
export const marketingService={context:async()=>context};
export const inboxService={read:async options=>read(options),detail:async(id,page)=>{if(id!=='wa-demo')throw new Error('Fixture outside scope');return detail(page)},configuration:async()=>({ai_configured:true,ai_auto_configured:true,staff_send_configured:true}),analytics:async()=>({volume:1,unresolved:1}),profiles:async()=>({profiles:{}}),sendStatus:async()=>({recipient_allowed:true}),markRead:async()=>null};
// A missing mutation method deliberately fails fixture QA if UI tries any business execution.
export const useAuth=()=>({user:{id:'fixture-user'},hasPermission:()=>true});
