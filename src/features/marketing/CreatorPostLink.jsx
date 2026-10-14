import {platformUrl} from '../../../server/creatorExtraction/urls.mjs';

export function creatorPostOriginalUrl(post){
 const value=post.platform==='xhs'?post.original_url:post.original_url||post.canonical_url||post.url;
 if(!value)return null;
 try{const parsed=platformUrl(value);if(parsed.platform!==post.platform)return null;
  if(post.platform==='xhs'&&post.post_key&&parsed.post_id&&parsed.post_id!==post.post_key)return null;
  return parsed.original_url||parsed.request_url;
 }catch{return null}
}
// Every Creator Post surface uses the same validated navigation authority.
export default function CreatorPostLink({post,children,...props}){
 const url=creatorPostOriginalUrl(post);
 return url?<a {...props} href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{children||'Open original Post'}</a>:<span className="creator-evidence-note" title="The original share link is unavailable. Open Post details to add it.">{children}<small>Original link unavailable</small></span>;
}
