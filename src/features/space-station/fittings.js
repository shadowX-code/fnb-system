import * as T from "three";
import { color as C, group, instrumentTexture, TAU } from "./modelKit.js";

export function bindFactoryWorkcell(workcell, target) {
  const turret = workcell.getObjectByName("RobotTurret");
  const fixture = workcell.getObjectByName("FixtureHead");
  const screens = ["FactoryInstrumentGlass", "OperatorGlass"].map(name => workcell.getObjectByName(name));
  if (!turret || !fixture || screens.some(screen => !screen?.geometry?.attributes.uv)) {
    throw new Error("The Factory workcell is missing a joint or mapped instrument screen.");
  }

  target(fixture, "factory", "equipment", [0, .68, 0], [1.05, 1.72, .90]);
  const display = instrumentTexture("factory");
  display.flipY = false;
  const glass = new T.MeshBasicMaterial({ map: display });
  for (const screen of screens) {
    screen.material = glass;
    screen.geometry.computeBoundingBox();
    const bounds = screen.geometry.boundingBox;
    const size = bounds.getSize(new T.Vector3());
    size.z = Math.max(size.z, .08);
    target(screen, "factory", "screen", bounds.getCenter(new T.Vector3()).toArray(), size.toArray());
  }

  const ctx = display.image.getContext("2d");
  let previousColumn = -1;
  return {
    animate(time) {
      turret.rotation.y = .09 * Math.sin(time * .5);
      fixture.rotation.y = -.07 * Math.sin(time * .5 + .8);
      const column = Math.floor((Math.sin(time * .72) + 1) * 15);
      if (column === previousColumn) return;
      previousColumn = column;
      ctx.fillStyle = "#164566";
      ctx.fillRect(276, 215, 180, 6);
      ctx.fillStyle = "#aaf9ff";
      ctx.fillRect(276 + 5 * column, 215, 24, 6);
      display.needsUpdate = true;
    },
    dispose() {
      glass.dispose();
      display.dispose();
    },
  };
}

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
  const map=document.createElement("canvas"); map.width=512;map.height=256;
  const ink=map.getContext("2d");
  ink.fillStyle="#116987"; ink.fillRect(0,0,512,256);
  ink.fillStyle="#72e5df";
  const land=[
    [[-168,66],[-147,71],[-130,60],[-108,70],[-84,72],[-56,53],[-74,45],[-81,30],[-97,21],[-88,16],[-83,9],[-103,18],[-118,32],[-128,51],[-143,59]],
    [[-81,11],[-66,12],[-50,1],[-35,-6],[-43,-23],[-55,-38],[-68,-55],[-75,-48],[-72,-29],[-81,-7]],
    [[-54,83],[-22,80],[-31,68],[-45,60],[-58,68]],
    [[-17,15],[-10,31],[5,37],[21,33],[32,31],[42,13],[51,11],[43,-3],[35,-12],[31,-30],[18,-35],[11,-18],[9,-4],[-2,5],[-16,7]],
    [[-10,36],[-10,44],[2,48],[6,57],[18,60],[28,70],[51,69],[70,73],[98,76],[123,72],[150,70],[178,66],[164,56],[147,51],[139,36],[126,38],[122,26],[109,19],[105,9],[97,18],[80,7],[73,20],[59,25],[55,17],[42,14],[35,29],[23,38],[11,45],[4,41]],
    [[112,-22],[119,-18],[131,-12],[137,-17],[145,-12],[154,-26],[147,-38],[132,-33],[116,-35]],
    [[47,-14],[51,-15],[47,-25],[44,-24]],[[130,32],[142,45],[144,43],[137,32]],
    [[-180,-73],[-140,-70],[-95,-75],[-61,-64],[-57,-73],[-5,-70],[48,-66],[99,-66],[152,-70],[180,-74],[180,-90],[-180,-90]],
  ];
  for(const continent of land) {
    ink.beginPath();
    continent.forEach(([lon,lat],i)=>{const x=(lon+180)*512/360,y=(90-lat)*256/180;if(i)ink.lineTo(x,y);else ink.moveTo(x,y);});
    ink.closePath();ink.fill();
  }
  ink.strokeStyle="#3a9ab0";ink.lineWidth=1;
  for(let x=0;x<512;x+=32){ink.beginPath();ink.moveTo(x,0);ink.lineTo(x,256);ink.stroke();}
  for(let y=0;y<256;y+=24){ink.beginPath();ink.moveTo(0,y);ink.lineTo(512,y);ink.stroke();}
  const texture=new T.CanvasTexture(map);texture.colorSpace=T.SRGBColorSpace;
  const world=new T.Mesh(new T.SphereGeometry(.69,32,20),new T.MeshBasicMaterial({map:texture,transparent:true,opacity:.91}));
  holo.add(world);
  k.part(holo,"ring","#6bdeec",0,0,0,1.50,1.50,.28,[1.07,0,-.28],true);
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
