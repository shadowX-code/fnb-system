import * as T from "three";
import { color as C, group, instrumentTexture, TAU } from "./modelKit.js";

function plant(k,p,x,z,scale=1) {
  const g=group(p,x,0,z); g.scale.setScalar(scale);
  k.part(g,"taper",C.cream,0,.22,0,.55,.43,.55,[Math.PI,0,0]);
  k.drum(g,C.rust,0,.43,0,.55,.08,.55);
  k.drum(g,"#534334",0,.475,0,.45,.025,.45);
  for(let i=0;i<9;i++) {
    const angle=i*2.4, height=.65+(i%3)*.18, reach=.20+(i%2)*.10;
    const dx=Math.sin(angle)*reach, dz=Math.cos(angle)*reach;
    k.beam(g,[0,.45,0],[dx,height,dz],.035,"#496c44");
    const leaf=k.part(g,"leaf",["#6f9e60","#9db854","#4c8862"][i%3],dx,height,dz,.20,.49,.10);
    leaf.rotation.order="YXZ"; leaf.rotation.y=angle; leaf.rotation.x=.68;
  }
}

function consoleDesk(k,p,x,z,width) {
  const g=group(p,x,0,z);
  k.soft(g,C.blue,0,.41,0,width*.85,.80,.70);
  k.box(g,C.ink,0,.12,.32,width*.90,.11,.15);
  k.soft(g,C.cream,0,.85,0,width,.13,.94);
  k.box(g,C.orange,0,.78,.45,width*.91,.07,.045);
  k.box(g,C.seam,-.34,.94,.16,.56,.04,.23);
  for(let j=0;j<3;j++) k.box(g,C.panel,-.34,.962,.09+j*.054,.48,.015,.023);
  k.ball(g,C.ink,.09,.956,.16,.13,.065,.17);
  for(const x of [-width*.31,width*.31]) k.box(g,C.seam,x,.46,.359,.36,.48,.055);
  return g;
}
function chair(k,p,x,z) {
  const g=group(p,x,0,z);
  k.drum(g,C.ink,0,.10,0,.48,.11,.48);
  k.drum(g,C.seam,0,.29,0,.085,.34,.085);
  k.soft(g,C.blue,0,.48,0,.50,.14,.46);
  k.soft(g,C.orange,0,.72,.22,.48,.45,.10);
}
function display(k,p,tex,x,y,z,width,angle=0) {
  const g=group(p,x,y,z); g.rotation.y=angle;
  k.soft(g,C.ink,0,0,0,width+.12,width*.47+.12,.13);
  const mesh=new T.Mesh(new T.PlaneGeometry(width,width*.47),new T.MeshBasicMaterial({map:tex}));
  mesh.position.z=.072; g.add(mesh);
  return g;
}
function addBooks(k,p,x,y,z) {
  ["#667b82","#c28a56","#799888","#e1c69b","#658e9d"].forEach((tint,i)=>{
    const h=.39+(i%3)*.08; k.box(p,tint,x+i*.135,y+h/2,z,.12,h,.26);
    k.box(p,C.cream,x+i*.135,y+h*.73,z+.136,.075,.026,.014);
  });
}
function robot(k,p) {
  const g=group(p,1.75,0,-.82);
  k.soft(g,C.blue,0,.24,0,1.39,.47,1.18);
  k.box(g,C.orange,0,.42,.59,1.19,.10,.04);
  k.drum(g,C.seam,0,.54,0,.90,.22,.9);
  k.drum(g,C.orange,0,.71,0,.60,.26,.60);
  const pivot=group(g,0,.8,0); pivot.userData.moving=true;
  function link(a,b,size) {
    k.beam(pivot,a,b,size,C.orange,true);
    const joint=k.drum(pivot,C.ink,...b,size*1.45,size*1.12,size*1.45);
    joint.rotation.x=Math.PI/2;
    k.drum(pivot,C.gold,b[0],b[1],b[2]+size*.59,size*.78,.06,size*.78,[Math.PI/2,0,0]);
  }
  link([0,0,0],[.40,.88,0],.31); link([.40,.88,0],[-.27,1.34,0],.24);
  link([-.27,1.34,0],[-.68,.96,.06],.17);
  for (const x of [-.77,-.59]) k.box(pivot,C.blue,x,.84,.07,.066,.24,.10);
  return t=>{ pivot.rotation.y=-.18+.34*Math.sin(t*.50); pivot.rotation.z=.055*Math.sin(t*.82); };
}
function studio(k,p) {
  const g=group(p,1.75,0,-.40); g.rotation.y=-.54;
  for(let i=0;i<3;i++) {
    const a=i*TAU/3; k.beam(g,[Math.sin(a)*.44,.03,Math.cos(a)*.44],[0,.92,0],.055,C.ink);
  }
  k.drum(g,C.seam,0,1,0,.08,.66,.08);
  const head=group(g,0,1.35,0); head.userData.moving=true;
  k.soft(head,C.ink,0,0,0,.49,.31,.38);
  k.drum(head,C.blue,0,0,.26,.26,.27,.26,[Math.PI/2,0,0]);
  k.drum(head,C.cyan,0,0,.41,.15,.035,.15,[Math.PI/2,0,0]);
  k.box(head,C.ink,0,.23,-.03,.11,.14,.25);
  k.soft(head,C.seam,0,.31,.02,.15,.13,.41);
  const lamp=group(p,2.83,0,-1.21); lamp.rotation.y=-.48;
  k.drum(lamp,C.ink,0,.06,0,.52,.10,.52); k.drum(lamp,C.seam,0,.85,0,.06,1.62,.06);
  k.part(lamp,"ring",C.ink,0,1.82,0,.73,.73,.9); k.part(lamp,"ring","#fff1cb",0,1.82,.04,.65,.65,.86,null,true);
  return t=>{ head.rotation.y=.22*Math.sin(t*.36); };
}
function globe(k,p) {
  const g=group(p,.15,0,.03);
  k.drum(g,C.blue,0,.16,0,1.93,.30,1.93);
  k.drum(g,C.ink,0,.39,0,1.55,.3,1.55);
  k.drum(g,C.cream,0,.59,0,1.99,.18,1.99);
  k.drum(g,C.glass,0,.70,0,1.63,.08,1.63);
  k.part(g,"ring",C.cyan,0,.75,0,1.29,1.29,.6,[Math.PI/2,0,0],true);
  const holo=group(g,0,1.62,0); holo.userData.moving=true;
  const world=new T.Mesh(new T.IcosahedronGeometry(.68,2),new T.MeshBasicMaterial({color:"#218caf",transparent:true,opacity:.73}));
  holo.add(world);
  const lines=new T.LineSegments(new T.WireframeGeometry(new T.SphereGeometry(.692,16,9)),new T.LineBasicMaterial({color:"#83edff",transparent:true,opacity:.48}));
  holo.add(lines);
  // Continental silhouettes projected onto the globe's surface.
  const continents=[[-105,49,37,18],[-66,-15,16,30],[15,6,21,30],[69,48,58,18],[134,-25,16,10]];
  for(let lat=-66;lat<76;lat+=6) for(let lon=-180;lon<180;lon+=7) {
    if(!continents.some(([x,y,w,h])=>((lon-x)/w)**2+((lat-y)/h)**2<1+.15*Math.sin(lon*.22+lat))) continue;
    const a=lon*Math.PI/180,b=lat*Math.PI/180;
    k.ball(holo,"#8af2e4",.695*Math.cos(b)*Math.sin(a),.695*Math.sin(b),.695*Math.cos(b)*Math.cos(a),.072,.066,.071,null,true);
  }
  return t=>{ holo.rotation.y=t*.17; holo.position.y=1.62+.043*Math.sin(t*1.5); };
}

export function furnish(k,base,room) {
  const tex=instrumentTexture(room.id);
  const callbacks=[];
  const wall=display(k,base,tex,.10,1.68,-2.05,room.id==="marketing" ? 2.73 : 3.18);
  const sweep=k.box(wall,room.accent,0,-.61,.086,.033,.12,.015,null,true);
  sweep.userData.moving=true;
  callbacks.push(t=>{ sweep.position.x=Math.sin(t*.72)*1.24; });
  consoleDesk(k,base,-1.25,-1.38,1.88);
  const monitor=display(k,base,tex,-1.24,1.20,-1.5,.78);
  k.box(monitor,C.seam,0,-.22,0,.09,.18,.10);
  chair(k,base,-1.23,-.58);
  plant(k,base,-2.95,.51,.96);
  if (room.id==="command") {
    callbacks.push(globe(k,base));
    for (const s of [-1,1]) {
      const wing=group(base,s*2.66,0,-.04); wing.rotation.y=-s*.69;
      k.soft(wing,C.blue,0,.44,0,1.36,.87,.69);
      k.soft(wing,C.cream,0,.89,0,1.49,.13,.80);
      display(k,wing,tex,0,1.17,-.14,1.10);
      for(let i=0;i<4;i++) k.box(wing,i%2 ? C.orange : C.cyan,-.36+i*.20,.972,.17,.12,.035,.10);
    }
    for(let i=0;i<16;i++) {
      const a=i*TAU/16;
      const belt=group(base,.15+Math.sin(a)*1.09,.056,.03+Math.cos(a)*1.09); belt.rotation.y=a;
      k.box(belt,C.seam,0,0,0,.38,.041,.09);
      k.box(belt,i%3 ? C.gold : C.cyan,0,.023,0,.25,.025,.041);
    }
    display(k,base,tex,2.35,1.39,-1.73,1.04,-.33);
    plant(k,base,2.87,-.83,.82);
  } else if(room.id==="finance") {
    consoleDesk(k,base,1.55,-1.38,1.69);
    display(k,base,tex,1.65,1.25,-1.52,.91,-.09);
    k.soft(base,C.blue,2.86,.55,-.74,.71,1.08,.52);
    for (const y of [.26,.58,.89]) {
      k.box(base,C.hull,2.86,y,-.455,.60,.25,.04);
      k.box(base,C.ink,2.86,y+.06,-.42,.17,.04,.03);
    }
    addBooks(k,base,1.90,.94,-1.39);
    const shelf=group(base,-2.25,1.40,-1.91);
    k.box(shelf,C.blue,0,-.08,0,.89,.085,.30);
    addBooks(k,shelf,-.28,-.035,.035);
    const paper=group(base,1.12,.94,-1.12); paper.rotation.y=-.16;
    k.box(paper,C.white,0,0,0,.39,.035,.27);
    for (let i=0;i<4;i++) k.box(paper,C.seam,-.02,.021,-.08+i*.04,.23,.013,.013);
    plant(k,base,2.91,.26,.75);
  } else if(room.id==="factory") {
    callbacks.push(robot(k,base));
    const rack=group(base,2.72,1.43,-1.75); rack.rotation.y=-.53;
    k.soft(rack,C.blue,0,0,0,.84,1.17,.13);
    for(let j=0;j<3;j++) {
      const x=-.25+j*.24;
      k.box(rack,C.hull,x,-.10,.10,.06,.49,.06);
      k.part(rack,"ring",C.gold,x,.20,.11,.175,.175,.41);
    }
    for(let i=0;i<7;i++) {
      k.box(base,C.ink,.86+i*.27,.046,.0,.19,.032,.175,[0,.43,0]);
      k.box(base,C.gold,.98+i*.27,.047,.0,.12,.032,.175,[0,.43,0]);
    }
    for(let i=0;i<3;i++) {
      const x=.65+i*.4; k.box(base,C.seam,x,1.0,-1.85,.09,1.83,.12); k.box(base,C.orange,x,1.83,-1.80,.15,.12,.14);
    }
    for (let i=0;i<2;i++) {
      k.soft(base,"#bb8954",2.90,.23+i*.42,.16,.68,.41,.54);
      k.box(base,C.ink,2.90,.25+i*.42,.44,.28,.12,.025);
    }
  } else {
    callbacks.push(studio(k,base));
    const casework=group(base,-2.58,0,-.79);
    k.soft(casework,C.blue,0,.28,0,.70,.53,.68);
    k.box(casework,C.violet,0,.37,.35,.61,.07,.04);
    for(const side of [-1,1]) {
      k.box(base,C.blue,1.88+side*.80,1.30,-1.70,.10,2.20,.13);
      k.box(base,side===1 ? "#dab1ff" : "#9adcdd",1.88+side*.80,1.32,-1.621,.055,1.94,.035,null,true);
    }
    const cyclorama=group(base,1.88,0,-1.69);
    k.soft(cyclorama,"#a895c8",0,1.04,0,1.38,1.99,.10);
    k.drum(cyclorama,"#e8c3ac",0,.36,.28,.73,.68,.73);
    k.ball(cyclorama,"#ed9a78",0,.86,.29,.38,.39,.38);
    addBooks(k,base,-2.05,.94,-1.62);
  }
  return callbacks;
}
