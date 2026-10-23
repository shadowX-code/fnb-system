// Shared by the existing Media Picker and advisory post readiness; server/provider validation remains authoritative.
export const isVideoFormat=format=>['video','reel'].includes(format);
export const publishingMediaEligible=(asset,format,channel)=>asset.state==='ready'&&(isVideoFormat(format)?asset.mime_type==='video/mp4':asset.mime_type?.startsWith('image/'))&&asset.size_bytes<=(isVideoFormat(format)?52428800:8388608)&&(channel!=='instagram'||isVideoFormat(format)||asset.mime_type==='image/jpeg');
