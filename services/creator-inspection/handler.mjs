export function createInspectionHandler({verifyVercelOidcToken,inspectPublic,inspectProfile,profileIdentity,platformUrl,inspectionBindings}){return async function(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'method_not_allowed'});
 const binding=inspectionBindings[process.env.CREATOR_INSPECTION_ENVIRONMENT];
 if(!binding||process.env.VERCEL_PROJECT_ID!==binding.workerProject||process.env.CREATOR_INSPECTION_PROJECT_ID!==binding.workerProject)return res.status(503).json({error:'runtime_unconfigured'});
 try{
  // Deployment Protection consumes its header; application verification uses a separate bearer.
  const token=req.headers.authorization?.match(/^Bearer ([\w.-]+)$/)?.[1];
  if(typeof token!=='string'||token.length>20000)throw new Error('missing_workload_token');
  await verifyVercelOidcToken(token,{projectId:binding.gatewayProject,ownerId:'team_4Xt5PL4r56PxeproAxgfJgqa',environment:'production',issuer:'https://oidc.vercel.com/shadowxs-projects-5e91a0d4',audience:'https://vercel.com/shadowxs-projects-5e91a0d4'});
 }catch(error){
  const allowed=['ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWKS_TIMEOUT','ERR_JWKS_NO_MATCHING_KEY','ERR_VERCEL_OIDC_TOKEN_VALIDATION'];
  console.info(JSON.stringify({event:'feedx.inspection.auth_denied',reason:error.message==='missing_workload_token'?'missing_workload_token':allowed.includes(error.code)?error.code:'workload_identity_rejected',claim:['aud','iss','exp','nbf'].includes(error.claim)?error.claim:undefined}));
  return res.status(401).json({error:'unauthorized'})
 }
 let body;try{body=typeof req.body==='string'?JSON.parse(req.body):req.body}catch{return res.status(400).json({error:'invalid_request'})}
 if(!body||JSON.stringify(body).length>5000||Object.keys(body).some(k=>!['version','environment','kind','url','deadline'].includes(k))||body.version!==1||body.environment!==binding.environment||!['post','profile'].includes(body.kind)||typeof body.url!=='string'||!Number.isSafeInteger(body.deadline))return res.status(400).json({error:'invalid_request'});
 const remaining=body.deadline-Date.now(),max=body.kind==='profile'?30000:45000;
 if(remaining<=0)return res.status(408).json({error:'inspection_limit'});
 if(remaining>max)return res.status(400).json({error:'invalid_deadline'});
 try{
  (body.kind==='profile'?profileIdentity:platformUrl)(body.url);
  const result=body.kind==='profile'?await inspectProfile(body.url,{deadline:body.deadline}):await inspectPublic(body.url,{deadline:body.deadline,allowPaid:false});
  return res.status(200).json(result);
 }catch{return res.status(400).json({error:'inspection_unavailable'})}
};}
