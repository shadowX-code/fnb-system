import { useEffect, useState } from 'react';
import { safePostMediaUrl } from './contentManagement.js';
import { marketingService } from './marketingService.js';

// Retired snapshots remain audit evidence, not readable media. Provider media is
// already bound to the exact published channel identity by the canonical read model.
export function postMediaItems(channel, assets = []) {
 const retained = channel.assets?.length ? channel.assets : channel.asset_ids?.map(id => assets.find(a => a.id === id)).filter(Boolean) || (channel.asset ? [channel.asset] : []);
 const provider = (channel.media?.length ? channel.media : channel.thumbnail_url ? [{type:'image',url:channel.thumbnail_url,previewOnly:true}] : []).flatMap(item => {
  const url = safePostMediaUrl(item.url, channel.channel);
  return url && ['image','video'].includes(item.type) ? [{...item,url,thumbnail_url:safePostMediaUrl(item.thumbnail_url,channel.channel)}] : [];
 });
 if (!retained.length || retained.some(a => a.state && a.state !== 'ready')) return provider;
 return retained.map((asset,index) => ({asset,type:asset.mime_type?.startsWith('video/')?'video':'image',fallback:provider.length===retained.length?provider[index]:undefined}));
}

export function postThumbnailItem(channel) {
 const item = postMediaItems(channel)[0];
 if (item?.type === 'image') return item;
 const url = safePostMediaUrl(item?.thumbnail_url || channel?.thumbnail_url,channel?.channel);
 return url ? {type:'image',url} : undefined;
}

// Each source is tried at most once. A fresh Sync URL or channel/asset change
// resets failure state; this never extends snapshot retention or queues a Sync.
export function usePostMediaSource(item) {
 const key = JSON.stringify(item || null);
 const [attempt,setAttempt] = useState({key,index:0});
 const index = attempt.key === key ? attempt.index : 0;
 const candidates = item ? [item,...(item.fallback?[item.fallback]:[])] : [];
 const source = candidates[index];
 const sourceKey = key + ':' + index;
 const [resolved,setResolved] = useState({key:'',url:''});
 useEffect(() => {
  let live = true;
  if (source?.asset) marketingService.assetUrl(source.asset).then(url => {if(live)setResolved({key:sourceKey,url});}).catch(() => {if(live)setAttempt({key,index:index+1});});
  else setResolved({key:sourceKey,url:source?.url || ''});
  return () => {live=false;};
 },[sourceKey]);
 return {item:source || item,url:resolved.key===sourceKey?resolved.url:'',failed:!!item&&!source,onError:()=>setAttempt({key,index:index+1})};
}
