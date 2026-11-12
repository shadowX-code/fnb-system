import {Link2, MessageCircle, Phone} from 'lucide-react';

const variable = /{{\s*([a-z][a-z0-9_]*|[1-9]\d*)\s*}}/gi;
const buttonIcons = {QUICK_REPLY:MessageCircle,URL:Link2,PHONE_NUMBER:Phone};

function withSamples(text, samples) {
 return text.replace(variable,(token,key)=>samples?.[key]?.trim()||token);
}

export default function WhatsAppMessagePreview({
 brandName, components, headerSamples, bodySamples, emptyBody='Your message will appear here.',
}) {
 const header=components.find(part=>part.type==='HEADER');
 const body=components.find(part=>part.type==='BODY')?.text;
 const footer=components.find(part=>part.type==='FOOTER')?.text;
 const buttons=components.flatMap(part=>part.buttons||[]).filter(button=>button.text?.trim());
 return <div className="wa-template-device" aria-label="WhatsApp message preview">
  <div className="wa-template-device-bar"><MessageCircle size={18} aria-hidden="true"/><strong>{brandName}</strong></div>
  <div className="wa-template-chat-surface">
   <div className="wa-template-message">
    <div className="wa-template-bubble">
     {header?.text?.trim()?<strong>{withSamples(header.text,headerSamples)}</strong>:null}
     {header?.format&&header.format!=='TEXT'?<small>Header requires {header.format.toLowerCase()} media or data.</small>:null}
     <p className={!body?.trim()?'wa-template-preview-empty':''}>{body?.trim()?withSamples(body,bodySamples):emptyBody}</p>
     {footer?.trim()?<small>{footer}</small>:null}
    </div>
    {buttons.length?<ul className="wa-template-preview-buttons">
     {buttons.map((button,index)=>{
      const Icon=buttonIcons[button.type]||MessageCircle;
      return <li key={index}><Icon size={15} aria-hidden="true"/><span>{button.text}</span></li>;
     })}
    </ul>:null}
   </div>
  </div>
 </div>;
}
