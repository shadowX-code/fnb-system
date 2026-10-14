const hosts={instagram:['instagram.com','www.instagram.com'],facebook:['facebook.com','www.facebook.com','m.facebook.com','fb.watch'],xhs:['xiaohongshu.com','www.xiaohongshu.com','xhslink.com','www.xhslink.com'],tiktok:['tiktok.com','www.tiktok.com','vt.tiktok.com','vm.tiktok.com']};
export function platformUrl(value){
 let u;try{u=new URL(value)}catch{throw new Error('invalid_url')}
 if(value.length>2000||u.protocol!=='https:'||u.port||u.username||u.password||!Object.values(hosts).flat().includes(u.hostname))throw new Error('unsupported_url');
 const platform=Object.keys(hosts).find(k=>hosts[k].includes(u.hostname));
 const p=u.pathname;let id,canonical;
 if(platform==='instagram'){id=p.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel|reels)\/([\w-]+)\/?$/)?.[1];if(id)canonical=`https://www.instagram.com/p/${id}/`;}
 if(platform==='xhs'){id=p.match(/^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1];if(id)canonical=`https://www.xiaohongshu.com/explore/${id.toLowerCase()}`;}
 if(platform==='tiktok'){const m=p.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/);id=m?.[2];if(m)canonical=`https://www.tiktok.com/@${m[1]}/video/${id}`;}
 if(platform==='facebook'){const m=p.match(/^\/(?:[^/]+\/)?(?:posts|videos|reel)\/([\w.-]+)\/?$/)||p.match(/^\/(?:reel)\/([\w.-]+)\/?$/);id=m?.[1]||(/^\/(?:permalink|story)\.php$/.test(p)?u.searchParams.get('story_fbid'):null)||(/^\/photo(?:\.php)?\/?$/.test(p)?u.searchParams.get('fbid'):null)||(/^\/watch\/?$/.test(p)?u.searchParams.get('v'):null);if(id)canonical=p.includes('/posts/')?`https://www.facebook.com${p.replace(/\/$/,'')}`:`https://www.facebook.com/watch/?v=${id}`;}
 const share=(platform==='tiktok'&&['vt.tiktok.com','vm.tiktok.com'].includes(u.hostname)&&/^\/[\w-]+\/?$/.test(p))||(platform==='xhs'&&u.hostname.endsWith('xhslink.com')&&/^\/(?:[a-z]\/)?[\w-]+\/?$/.test(p))||(platform==='facebook'&&(u.hostname==='fb.watch'&&/^\/[\w-]+\/?$/.test(p)||/^\/share\/(?:[prv]\/)?[\w-]+\/?$/.test(p)));
 if(!id&&!share)throw new Error('unsupported_post_url');
 u.hash='';const keep={instagram:['img_index'],facebook:['story_fbid','id','fbid','v'],xhs:['xsec_token','xsec_source'],tiktok:[]}[platform];for(const key of [...u.searchParams.keys()])if(!keep.includes(key))u.searchParams.delete(key);return {platform,post_id:id||null,canonical_url:canonical||u.origin+u.pathname,request_url:u.href,share};
}
export function allowedResource(value,platform){
 let u;try{u=new URL(value)}catch{return false}
 if(u.protocol!=='https:'||u.port||u.username||u.password)return false;
 const domains={instagram:['instagram.com','cdninstagram.com','fbcdn.net'],facebook:['facebook.com','fb.watch','fbcdn.net','fbsbx.com'],xhs:['xiaohongshu.com','xhslink.com','xhscdn.com','xiaohongshu.net'],tiktok:['tiktok.com','tiktokcdn.com','tiktokcdn-us.com','tiktokv.com','byteoversea.com','ibytedtos.com','muscdn.com','tiktokv.us']};
 return domains[platform]?.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))||false;
}
export function publicThumbnail(value,platform){if(!value||/(access_token|authorization|appsecret)/i.test(value)||!allowedResource(value,platform))return null;return value.length<3000?value:null;}
