import {callReader} from '../server/xhsReaderPilot/client.mjs';
export const config={maxDuration:40};
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(process.env.VITE_SUPABASE_URL!=='https://ujkzdaaadnvcfayuldmh.supabase.co'||process.env.VERCEL_PROJECT_ID&&process.env.VERCEL_PROJECT_ID!=='prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi'||process.env.VERCEL_GIT_COMMIT_REF&&process.env.VERCEL_GIT_COMMIT_REF!=='dev')return res.status(403).json({error:'Staging pilot only.'});
 if(req.method!=='POST'||!/^Bearer [\w.-]+$/.test(req.headers.authorization||''))return res.status(401).json({error:'Sign in as an authorized administrator.'});
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{return res.status(400).json({error:'Invalid request.'})}
 if(!body||JSON.stringify(body).length>5000||!['status','login_start','login_check','disconnect'].includes(body.action))return res.status(400).json({error:'Invalid request.'});
 try{return res.status(200).json(await callReader({...body,authorization:req.headers.authorization}))}
 catch(e){return res.status(400).json({error:e.message==='reader_not_configured'?'The isolated Reader is not configured. Live access and encrypted session storage require approval.':'Reader unavailable or access denied. No login was completed; reconnect only after reviewing the cause.'})}
}
