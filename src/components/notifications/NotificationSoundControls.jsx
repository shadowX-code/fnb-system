import {useRef,useState} from 'react';
import {Volume2,VolumeX} from 'lucide-react';
import FloatingLayer from '../ui/FloatingLayer.jsx';
import useNotificationSound from './useNotificationSound.js';
import './notificationSound.css';
export function NotificationSoundSettings({sound}) {
 const [pending,setPending]=useState(false);
 const status=sound.error || (!sound.available?'This browser cannot safely coordinate Inbox sounds.':!sound.enabled?'Off':sound.ready?(sound.volume?'Ready in this tab':'Muted · volume 0%'):'Enable audio in this tab');
 async function enable(){setPending(true);try{await sound.client.enable()}finally{setPending(false)}}
 return <section className="notification-sound-settings" aria-label="Inbox sound settings"><header><strong>Inbox sounds</strong><span role="status" aria-label="Inbox sound readiness">{status}</span></header><p>Actionable messages and AI handoffs · Marketing only. Routine AI replies stay silent.</p><div className="notification-sound-actions"><button type="button" className="btn-secondary" disabled={!sound.available||pending} onClick={sound.ready?()=>sound.client.disable():enable}>{pending?'Enabling…':sound.ready?'Turn off':sound.enabled?'Enable in this tab':'Enable sounds'}</button>{sound.enabled&&!sound.ready?<button type="button" className="btn-secondary" onClick={()=>sound.client.disable()}>Turn off</button>:null}<button type="button" className="btn-secondary" disabled={!sound.ready||!sound.volume} onClick={()=>sound.client.preview()}>Preview sound</button></div><label className="notification-volume">Volume <input type="range" min="0" max="100" step="5" aria-label="Inbox sound volume" value={Math.round(sound.volume*100)} onChange={event=>sound.client.setVolume(Number(event.target.value)/100)}/><output>{Math.round(sound.volume*100)}%</output></label></section>;
}
export default function NotificationSoundControls({identity}) {
 const sound=useNotificationSound(identity),[open,setOpen]=useState(false),anchor=useRef(null);
 return <><button ref={anchor} type="button" className="icon-btn" aria-label="Inbox sound settings" aria-expanded={open} title={sound.ready?'Inbox sounds ready':'Inbox sounds'} onClick={()=>setOpen(v=>!v)}>{sound.enabled?<Volume2 size={16}/>:<VolumeX size={16}/>}</button><FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchor} align="end" width={300} minWidth={260} estimatedHeight={250}><NotificationSoundSettings sound={sound}/></FloatingLayer></>;
}
