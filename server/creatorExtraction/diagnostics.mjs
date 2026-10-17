export const boundedTiming=start=>Math.min(60000,Math.max(0,Math.round(performance.now()-start)));
export const browserDiagnostics=()=>({attempted:false,succeeded:false,stage:'not_attempted',failed_stage:null,duration_ms:0,load_ms:0,launch_ms:0,render_ms:0,cleanup_ms:0});
export async function measureBrowser(diagnostics,run){
 const start=performance.now();diagnostics.attempted=true;
 try{const result=await run();diagnostics.succeeded=true;diagnostics.stage='complete';return result;}
 finally{diagnostics.duration_ms=boundedTiming(start);}
}
