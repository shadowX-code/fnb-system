export async function disconnectBusinessConnection(mode:string,input:any,actions:{control:(action:string,data:any)=>Promise<any>;revoke:(pending:any)=>Promise<void>}) {
 if(mode==='local')return actions.control('local',{generation:input.generation});
 if(mode!=='global' || input.confirmed!==true || input.scopeAcknowledged!=='google_project')throw new Error('Confirm Google-wide revocation.');
 const pending=await actions.control('revoke_begin',input);
 if(!pending.disconnected){await actions.revoke(pending);await actions.control('revoke_finish',{generation:pending.generation});}
 return {ok:true};
}
