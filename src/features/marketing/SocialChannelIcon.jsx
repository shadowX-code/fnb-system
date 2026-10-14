import {useId} from 'react';
import tiktok from '../../assets/social/tiktok.svg';
import xhs from '../../assets/social/xiaohongshu.svg';
import './socialChannelIcon.css';
export default function Channel({ value }) {
  const gradient = useId();
  const label = {facebook:"Facebook",instagram:"Instagram",tiktok:"TikTok",xhs:"Xiaohongshu"}[value];
  if(!label)return null;
  if(value==="tiktok"||value==="xhs")return <span className={`cm-channel cm-channel-${value}`} role="img" aria-label={label} title={label}><img src={value==="tiktok"?tiktok:xhs} alt=""/></span>;
  return <span className={`cm-channel cm-channel-${value}`} role="img" aria-label={label} title={label}>
    {value === "facebook" ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#fff"/><path fill="#1877F2" d="M24 12a12 12 0 1 0-13.875 11.855v-8.386H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.313 0 2.686.235 2.686.235v2.953H15.83c-1.49 0-1.955.925-1.955 1.874V12h3.328l-.532 3.469h-2.796v8.386A12.003 12.003 0 0 0 24 12Z"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop stopColor="#FFDC80"/><stop offset=".3" stopColor="#F77737"/><stop offset=".6" stopColor="#E1306C"/><stop offset="1" stopColor="#833AB4"/></linearGradient></defs><rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke={`url(#${gradient})`} strokeWidth="2.5"/><circle cx="12" cy="12" r="4.25" fill="none" stroke={`url(#${gradient})`} strokeWidth="2.5"/><circle cx="18" cy="6" r="1.4" fill={`url(#${gradient})`}/></svg>}
  </span>;
}
