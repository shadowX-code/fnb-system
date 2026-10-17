import {FileImage,Film,Smartphone,Palette,Camera} from 'lucide-react';
import Badge from '../../components/ui/Badge.jsx';
import {taskTypes} from './contentPlanner.js';
const styles={post:['indigo',FileImage],reel:['violet',Film],story:['fuchsia',Smartphone],design:['cyan',Palette],photography:['orange',Camera]};
export default function ContentTypeBadge({value}){
 const [tone,Icon]=styles[value]||['neutral',FileImage];
 return <Badge tone={tone} className="content-type-badge"><Icon size={11} aria-hidden="true"/>{taskTypes.find(t=>t.value===value)?.label||value||'Content'}</Badge>;
}
