import {useState} from 'react';
import MarketingMediaPreview from './MarketingMediaPreview.jsx';
import SocialChannelIcon from './SocialChannelIcon.jsx';
import {safePostMediaUrl} from './contentManagement.js';
export default function CreatorPostThumbnail({post,assets=[]}){
 const [failed,setFailed]=useState(false),asset=assets.find(a=>a.id===post.asset_id),url=safePostMediaUrl(post.public_observation?.thumbnail_url);
 if(asset)return <MarketingMediaPreview compact interactive={false} asset={asset}/>;
 return url&&!failed?<img className="creator-post-thumbnail" src={url} alt="Post preview" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span className="creator-post-fallback"><SocialChannelIcon value={post.platform}/></span>;
}
