export function createInspectionHandler({verifyVercelOidcToken,inspectPublic,inspectProfile,profileIdentity,platformUrl}){return async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 if(process.env.CREATOR_INSPECTION_ENVIRONMENT!=='staging'||process.env.VERCEL_PROJECT_ID!==process.env.CREATOR_INSPECTION_PROJECT_ID||!process.env.CREATOR_INSPECTION_PROJECT_ID)return res.status(503).json({error:'runtime_unconfigured'});
 try{
  const token=req.headers['x-vercel-trusted-oidc-idp-token'];
  if(typeof token!=='string'||token.length>20000)throw new Error('unauthorized');
  await verifyVercelOidcToken(token,{projectId:'prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi',ownerId:'team_4Xt5PL4r56PxeproAxgfJgqa',environment:'production',issuer:'https://oidc.vercel.com/shadowxs-projects-5e91a0d4',audience:'https://vercel.com/shadowxs-projects-5e91a0d4'});
 }catch{return res.status(401).json({error:'unauthorized'})}
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{return res.status(400).json({error:'invalid_request'})}
 if(!body||JSON.stringify(body).length>5000||Object.keys(body).some(k=>!['version','environment','kind','url','deadline'].includes(k))||body.version!==1||body.environment!=='staging'||!['post','profile'].includes(body.kind)||typeof body.url!=='string'||!Number.isSafeInteger(body.deadline))return res.status(400).json({error:'invalid_request'});
 const remaining=body.deadline-Date.now(),max=body.kind==='profile'?30000:45000;
 if(remaining<=0)return res.status(408).json({error:'inspection_limit'});
 if(remaining>max)return res.status(400).json({error:'invalid_deadline'});
 try{
  (body.kind==='profile'?profileIdentity:platformUrl)(body.url);
  const result=body.kind==='profile'?await inspectProfile(body.url,{deadline:body.deadline}):await inspectPublic(body.url,{deadline:body.deadline,allowPaid:false});
  return res.status(200).json(result);
 }catch{return res.status(400).json({error:'inspection_unavailable'})}
};}
