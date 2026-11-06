import {getVercelOidcToken} from '@vercel/oidc';
import {platformUrl} from './urls.mjs';
import {profileIdentity} from './profileIdentity.mjs';
const endpoint='https://feedx-creator-inspection-staging.vercel.app/api/inspect';
async function inspect(url,kind){
 const identity=kind==='profile'?profileIdentity(url):platformUrl(url),deadline=Date.now()+(kind==='profile'?30000:45000);
 if(process.env.CREATOR_INSPECTION_ENDPOINT!==endpoint||process.env.VERCEL_PROJECT_ID!=='prj_t6uJtKPDu9GuyefG6IqAfxh5YoIi')throw new Error('inspection_runtime_unavailable');
 const token=await getVercelOidcToken();
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','x-vercel-trusted-oidc-idp-token':token},body:JSON.stringify({version:1,environment:'staging',kind,url,deadline}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
 if(!response.ok)throw new Error('inspection_runtime_unavailable');
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>1000000)throw new Error('inspection_response_invalid');chunks.push(chunk)}
 const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(!result||result.platform!==identity.platform||!['public_extracted','unavailable'].includes(result.metadata_status))throw new Error('inspection_response_invalid');
 if(kind==='profile'){if(profileIdentity(result.profile_url).profile_url!==identity.profile_url)throw new Error('profile_identity_changed')}
 else if(result.canonical_url){const resolved=platformUrl(result.canonical_url);if(resolved.platform!==identity.platform||identity.post_id&&identity.post_id!==resolved.post_id)throw new Error('post_identity_changed')}
 return result;
}
export const inspectPublic=url=>inspect(url,'post');
export const inspectProfile=url=>inspect(url,'profile');
