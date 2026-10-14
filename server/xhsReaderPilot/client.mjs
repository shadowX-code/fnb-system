export async function callReader({action,org,brand,url,authorization},env=process.env){
 if(env.MARKETING_XHS_READER_ENABLED!=='true')throw new Error('reader_not_configured');
 const endpoint=new URL(env.MARKETING_XHS_READER_URL||'');if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/v1/reader')throw new Error('reader_configuration_invalid');
 const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action,org,brand,url}),signal:AbortSignal.timeout(30000)});
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>64000)throw new Error('reader_response_invalid');chunks.push(chunk)}const text=Buffer.concat(chunks).toString('utf8');let result;try{result=JSON.parse(text)}catch{throw new Error('reader_response_invalid')}
 if(!response.ok)throw new Error(/^reader_[a-z_]+$/.test(result.error)?result.error:'reader_unavailable');return result;
}
