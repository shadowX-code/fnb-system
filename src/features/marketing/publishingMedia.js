// Shared picker and advisory checks; immutable server bytes and provider processing remain authoritative.
export const isVideoFormat=format=>['video','reel'].includes(format);
export const publishingMimeTypes=(format,channel)=>isVideoFormat(format)?['video/mp4']:channel==='instagram'&&['carousel','story'].includes(format)?['image/jpeg','video/mp4']:channel==='instagram'?['image/jpeg']:['image/jpeg','image/png','image/webp'];
export const publishingMediaEligible=(asset,format,channel)=>asset.state==='ready'&&publishingMimeTypes(format,channel).includes(asset.mime_type)&&asset.size_bytes<=(asset.mime_type==='video/mp4'?52428800:8388608);
export const extendedInstagramVariant=(variant,assets)=>variant?.channel==='instagram'&&(variant.format==='story'||variant.format==='carousel'&&variant.asset_ids.some(id=>assets.some(a=>a.id===id&&a.mime_type==='video/mp4')));

// Convertible input is selectable, but never publishing-ready until server verification succeeds.
export const instagramPngPreparation=(asset,format,channel)=>channel==='instagram'&&['image','carousel'].includes(format)&&asset.mime_type==='image/png';
export const publishingSelectionMimeTypes=(format,channel)=>[...publishingMimeTypes(format,channel),...(channel==='instagram'&&['image','carousel'].includes(format)?['image/png']:[])];
export const publishingMediaSelectable=(asset,format,channel)=>publishingMediaEligible(asset,format,channel)||asset.state==='ready'&&instagramPngPreparation(asset,format,channel)&&asset.size_bytes>0&&asset.size_bytes<=104857600;
