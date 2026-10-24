import Badge from '../../components/ui/Badge.jsx';
import {publicationAvailability} from './postAvailability.js';
export default function PostLiveAvailability({channels}){
 const info=publicationAvailability(channels);if(!info)return null;
 return <span className="inline-flex max-w-full" title={`${info.details}. ${info.help}`} aria-label={`Live availability: ${info.details}`}><Badge tone={info.tone}>{info.label}</Badge></span>;
}
