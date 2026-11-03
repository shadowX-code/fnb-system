import { useId } from 'react';

// The plate stays inside the existing 280×112 node; its port ends at the bottom handle.
export default function NetworkCoreNode() {
  const id = useId().replace(/:/g, '');
  return <div className="son-core-chip">
    <svg className="son-core-shell" viewBox="0 0 280 112" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-glass`} x1="36" y1="6" x2="196" y2="102" gradientUnits="userSpaceOnUse">
          <stop stopColor="#214f59"/><stop offset=".45" stopColor="#10343f"/><stop offset="1" stopColor="#09232e"/>
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="140" y1="81" x2="140" y2="103" gradientUnits="userSpaceOnUse">
          <stop stopColor="#15505a"/><stop offset=".35" stopColor="#0b2d39"/><stop offset="1" stopColor="#061923"/>
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="55" y1="8" x2="183" y2="83" gradientUnits="userSpaceOnUse">
          <stop stopColor="#c5fff5" stopOpacity=".12"/><stop offset="1" stopColor="#a4f9ed" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path className="son-core-side" d="M4 77L27 15H253L276 77V91Q276 96 270 98L250 102H30L10 98Q4 96 4 91Z" fill={`url(#${id}-side)`}/>
      <path className="son-core-top" d="M32 7H248Q253 7 255 12L275 74Q278 82 270 84H10Q2 82 5 74L25 12Q27 7 32 7Z" fill={`url(#${id}-glass)`}/>
      <path className="son-core-sheen" d="M35 12H244L252 35L19 60L31 16Q32 12 35 12Z" fill={`url(#${id}-sheen)`}/>
      <path className="son-core-rim" d="M6 80Q8 84 14 84H266Q272 84 274 80M13 94L31 98H249L267 94"/>
      <path className="son-core-etch" d="M39 16H73M207 16H241M18 73H39M241 73H262"/>
      <path className="son-core-slots" d="M35 89V93M42 89V93M49 89V93M231 89V93M238 89V93M245 89V93"/>
      <path className="son-core-port" d="M130 102H150V106L145 111H135L130 106Z"/>
      <path className="son-core-port-light" d="M135 106H145M140 108V112"/>
    </svg>
    <div className="son-core-copy">
      <div className="son-core-identity"><img src="/logo-icon.jpg" alt="" draggable="false" width="30" height="30"/><strong>FeedX OS</strong></div>
      <p>F&amp;B Operations Core</p>
    </div>
  </div>;
}
