import * as T from "three";
import { color as C, group, TAU } from "./modelKit.js";
import { roomById } from "./departments.js";

const floorOutline = [[-2.65,-2.35],[2.65,-2.35],[3.6,-1.45],[3.6,1.35],[2.6,2.22],[-2.6,2.22],[-3.6,1.35],[-3.6,-1.45]];

function ringPlane(parent) {
  // Set the wheel aft of every pressure hull while keeping the rear crown above the rooms.
  const plane = group(parent, -.65, -1.45, -6.2);
  plane.rotation.x = .78;
  return plane;
}

function deck(parent, outline, y, thickness, tint) {
  const shape = new T.Shape();
  outline.forEach(([x,z], i) => i ? shape.lineTo(x,-z) : shape.moveTo(x,-z));
  shape.closePath();
  const geometry = new T.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.07, bevelThickness: 0.05, curveSegments: 1 });
  geometry.rotateX(-Math.PI/2);
  const mesh = new T.Mesh(geometry,new T.MeshStandardMaterial({color:tint,roughness:0.76}));
  mesh.receiveShadow=true; mesh.castShadow=true;
  mesh.position.y=y; parent.add(mesh);
}

export function buildCabin(k, room, base) {
  const { box, soft, drum, part } = k;
  const hull = group(base);
  hull.scale.set(...room.hullScale);
  deck(hull, floorOutline, -0.78, 0.48, C.blue);
  deck(hull, floorOutline.map(([x,z])=>[x*1.024,z*1.024]), -0.43, 0.27, C.hull);
  deck(hull, floorOutline.map(([x,z])=>[x*0.986,z*0.986]), -0.11, 0.08, C.floor);
  for (let i=0;i<floorOutline.length;i++) {
    const a=floorOutline[i], b=floorOutline[(i+1)%floorOutline.length];
    const mid=group(hull,(a[0]+b[0])/2,0,(a[1]+b[1])/2);
    mid.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);
    const w=Math.hypot(b[0]-a[0],b[1]-a[1]);
    box(mid,C.ink,0,-0.27,0,w,.13,.15);
    soft(mid,i%2 ? C.cyan : C.orange,0,-.26,0,w*.64,.055,.19);
    for (const x of [-w*.37,w*.37]) {
      box(mid,C.seam,x,-.28,0,.19,.41,.21);
      box(mid,C.ink,x,-.27,.115,.085,.085,.035);
    }
  }
  // Panel joints, threshold, and flush runway lights on the open deck.
  for (const x of [-2,-.66,.66,2]) box(hull,"#b6a589",x,.027,-.05,.018,.012,3.9);
  for (const z of [-1,0,1.07]) box(hull,"#b6a589",0,.027,z,6.3,.012,.018);
  for (const x of [-2.15,-1.4,1.4,2.15]) box(hull,C.gold,x,.044,1.98,.39,.025,.06);
  for(const side of [-1,1]) {
    for(let i=0;i<4;i++) {
      const z=-.95+i*.68;
      box(hull,C.seam,side*3.27,.037,z,.23,.025,.43);
      for(let j=0;j<3;j++) box(hull,C.ink,side*3.27,.055,z-.12+j*.12,.17,.016,.043);
    }
  }
  // Rear pressure wall with angled returns. Leave the front half open all the way to the floor.
  for (const [a,b] of [[floorOutline[7],floorOutline[0]],[floorOutline[0],floorOutline[1]],[floorOutline[1],floorOutline[2]]]) {
    const w=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const frame=group(hull,(a[0]+b[0])/2,0,(a[1]+b[1])/2);
    frame.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);
    box(frame,C.ink,0,1.25,0,w+.08,2.58,.29);
    box(frame,C.cream,0,1.26,.14,w-.06,2.39,.16);
    box(frame,C.blue,0,.19,.24,w,.23,.14);
    box(frame,C.hull,0,2.62,.02,w+.08,.23,.53);
    box(frame,C.orange,0,2.54,.30,w*.78,.06,.055);
    box(frame,C.white,0,2.45,.29,w*.77,.06,.08);
    for (const x of [-w*.45,w*.45]) {
      box(frame,C.seam,x,1.28,.22,.15,2.58,.20);
      box(frame,C.hull,x,1.30,.32,.095,2.35,.07);
      box(frame,C.rust,x,2.49,.32,.22,.23,.17);
    }
  }
  for (const sign of [-1,1]) {
    const side=group(hull,sign*3.48,0,-.23);
    // Rounded external buttresses follow a cabin cross-section.
    box(side,C.hull,0,.51,-.44,.32,1.04,1.84);
    box(side,C.ink,0,.99,-.46,.36,.13,1.87);
    for (const z of [-1.14,-.42,.35]) box(side,C.orange,sign*.15,.46,z,.11,.72,.15);
    k.beam(side,[0,2.56,-1.27],[0,2.56,-.58],.25,C.hull,true);
    k.beam(side,[0,2.56,-.58],[0,1.7,.05],.25,C.hull,true);
    k.beam(side,[0,1.7,.05],[0,.92,.35],.19,C.blue,true);
    // Service pods, pipes and landing pads are visible beneath the cutaway.
    const pod=group(hull,sign*2.68,-.67,.35);
    drum(pod,C.ink,0,-.13,0,.88,.48,.88);
    drum(pod,C.orange,0,-.34,0,.72,.15,.72);
    part(pod,"taper",C.blue,0,-.5,0,.68,.24,.68);
    drum(pod,C.cyan,0,-.62,0,.39,.025,.39);
  }
  // Layered roof fairings wrap the back third of each pressure cell. The open arch faces the viewer.
  for(const z of [-2.27,-1.55]) {
    const path=[[-3.57,.96],[-3.57,1.87],[-2.99,2.69],[-2.35,2.97],[2.35,2.97],[2.99,2.69],[3.57,1.87],[3.57,.96]];
    for(let i=0;i<path.length-1;i++) {
      const [ax,ay]=path[i], [bx,by]=path[i+1];
      const panel=group(hull,(ax+bx)/2,(ay+by)/2,z);
      panel.rotation.z=Math.atan2(by-ay,bx-ax);
      const length=Math.hypot(bx-ax,by-ay);
      box(panel,C.ink,0,0,0,length+.04,.34,.85);
      box(panel,C.hull,0,.065,-.016,length-.035,.29,.86);
      box(panel,C.seam,0,.202,-.17,length*.91,.025,.10);
      box(panel,C.orange,0,-.125,.434,length*.76,.060,.035);
      if(i===3) for(const px of [-1.85,-.77,.77,1.85]) {
        box(panel,C.blue,px,.21,0,.115,.038,.83);
        box(panel,C.orange,px,.237,.22,.117,.025,.27);
      }
    }
  }
  // Service cabinets and recessed lighting along the forward fascia.
  for(const sign of [-1,1]) {
    box(hull,C.blue,sign*1.75,-.43,2.24,1.22,.52,.19);
    box(hull,C.hull,sign*1.75,-.43,2.35,1.06,.40,.06);
    for(let j=0;j<6;j++) box(hull,C.ink,sign*1.75-.34+.13*j,-.43,2.385,.062,.22,.025,[0,0,-.25]);
    box(hull,C.orange,sign*2.57,-.47,2.14,.27,.5,.25);
  }
  const hatch=group(hull,-2.97,0,-1.66); hatch.rotation.y=.76;
  soft(hatch,C.blue,0,1.05,.14,.84,1.91,.14);
  soft(hatch,C.seam,0,1.03,.24,.69,1.67,.07);
  box(hatch,C.ink,0,1.43,.29,.44,.30,.03);
  box(hatch,C.cyan,0,1.43,.315,.35,.20,.025);
}

// Intersect the bridge centreline with the actual chamfered hull footprint.
function berth(room,other) {
  const dx=other.at[0]-room.at[0],dz=other.at[2]-room.at[2];
  const [sx,,sz]=room.hullScale;
  for(let i=0;i<floorOutline.length;i++) {
    const [ax,az]=floorOutline[i], [bx,bz]=floorOutline[(i+1)%floorOutline.length];
    const ex=(bx-ax)*sx,ez=(bz-az)*sz, det=dx*ez-dz*ex;
    if(Math.abs(det)<.0001) continue;
    const t=(ax*sx*ez-az*sz*ex)/det, u=(ax*sx*dz-az*sz*dx)/det;
    if(t>0 && u>=0 && u<=1) return [room.at[0]+dx*t,room.at[1],room.at[2]+dz*t];
  }
  return room.at;
}

function bridge(k, root, a, b) {
  const dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2], length=Math.hypot(dx,dy,dz);
  const span=group(root,(a[0]+b[0])/2,(a[1]+b[1])/2-.13,(a[2]+b[2])/2);
  span.rotation.order="YXZ"; span.rotation.y=Math.atan2(dx,dz);
  span.rotation.x=-Math.atan2(dy,Math.hypot(dx,dz));
  k.box(span,C.blue,0,-.20,0,1.07,.31,length);
  k.box(span,C.cream,0,-.012,0,.96,.09,length);
  for (let z=-length/2+.15;z<length/2;z+=.48) {
    k.box(span,C.seam,0,.038,z,.91,.02,.028);
    if (Math.round((z+length/2)/.48)%2 === 0) for (const x of [-.51,.51]) k.box(span,C.blue,x,.27,z,.065,.55,.065);
  }
  for (const x of [-.51,.51]) {
    k.box(span,C.orange,x,.53,0,.075,.07,length);
    k.box(span,C.seam,x,.28,0,.04,.04,length);
  }
}

export function buildInfrastructure(k, base, rooms) {
  const orbit=ringPlane(base);
  orbit.name="OrbitalRingPlane";
  function point(i, r, y) { const t=i*TAU/64; return [Math.sin(t)*r,y,Math.cos(t)*r]; }
  for (let i=0;i<64;i++) {
    // The authored Factory sector spans 281.25° to 315° in this plane.
    if (i>=50 && i<56) continue;
    for (const [r,y,tint,gauge] of [[10.2,0,C.hull,.66],[9.66,-.75,C.blue,.32],[10.64,-.58,C.seam,.24],[10.54,.08,C.orange,.13]]) {
      k.beam(orbit,point(i,r,y),point(i+1,r,y),gauge,tint,true);
    }
    k.beam(orbit,point(i,9.66,-.75),point(i+1,10.2,-.05),.09,C.seam,true);
    if(i%2===0) {
      const p=point(i,10.2,0), collar=group(orbit,...p); collar.rotation.y=i*TAU/64;
      k.box(collar,C.blue,0,0,0,.20,.75,.82);
      k.box(collar,i%4 ? C.gold : C.cyan,0,.39,0,.12,.04,.51);
    }
  }
  for (const [from,to] of [["command","finance"],["command","marketing"],["command","factory"],["finance","factory"],["finance","marketing"]]) {
    const first=rooms.find(r=>r.id===from), second=rooms.find(r=>r.id===to);
    bridge(k,base,berth(first,second),berth(second,first));
  }
  for (const sector of [42, 23]) {
    const array=group(orbit,...point(sector,10.2,.2));
    array.rotation.order="YXZ";
    array.rotation.y=sector*TAU/64-Math.PI;
    array.rotation.x=.24;
    k.box(array,C.hull,0,0,-1.12,.27,.23,3.25);
    k.drum(array,C.orange,0,.05,-1.5,.52,.45,.52);
    for (const side of [-1,1]) {
      const wing=group(array,side*1.25,0,-1.94);
      k.box(wing,C.hull,0,0,0,2.34,.12,2.86);
      for(let i=0;i<4;i++) for(let j=0;j<6;j++) k.box(wing,(i+j)%3 ? "#285289":"#37649a",(i-1.5)*.54,.076,(j-2.5)*.445,.50,.03,.41);
    }
  }
  const dock=group(orbit,0,.34,10.2);
  orbit.updateMatrix();
  const command=roomById.command.at;
  for (const side of [-1,1]) {
    const foot=new T.Vector3(side*.8,0,10.2).applyMatrix4(orbit.matrix);
    k.beam(base,[command[0]+side*2.2, command[1]-.68, command[2]-.78],foot.toArray(),.25,C.blue,true);
  }
  k.box(dock,C.hull,0,0,0,2.3,.4,1.1);
  for(const x of [-.78,.78]) {
    k.soft(dock,C.orange,x,.2,.13,.42,.37,.99);
    k.box(dock,C.ink,x,.38,.12,.30,.04,.45);
  }
}

// Each authored assembly retains its glTF axis conversion below the matching station socket.
export function mountFactoryJunction(junction, factoryRoot, infrastructure) {
  const corner=junction.getObjectByName("FactoryCorner");
  const collar=junction.getObjectByName("BridgeCollar");
  const sector=junction.getObjectByName("RingSector");
  const orbit=infrastructure.getObjectByName("OrbitalRingPlane");
  if (!corner || !collar || !sector) throw new Error("The Factory junction is missing an assembly.");

  const {factory, command}=roomById;
  const start=berth(factory,command), end=berth(command,factory);
  const socket=group(factoryRoot,start[0]-factory.at[0],0,start[2]-factory.at[2]);
  socket.rotation.y=Math.atan2(end[0]-start[0],end[2]-start[2]);
  socket.add(collar);
  orbit.add(sector);
  factoryRoot.add(corner);
}

// A short inspection flight around the forward docking collar gives scale to the ring.
export function serviceShuttle(k,scene) {
  const root=ringPlane(scene), craft=group(root); craft.userData.moving=true;
  k.ball(craft,C.hull,0,0,0,.50,.38,1.53);
  k.ball(craft,C.glass,0,.12,.27,.38,.26,.66);
  k.box(craft,C.orange,0,.136,-.42,.22,.081,.51);
  for(const side of [-1,1]) {
    const wing=group(craft,side*.35,-.04,-.10); wing.rotation.y=-side*.56;
    k.soft(wing,C.hull,0,0,0,.65,.09,.36);
    k.soft(wing,C.orange,side*.25,.045,0,.13,.035,.32);
    k.ball(craft,C.blue,side*.226,-.11,-.42,.21,.19,.59);
    k.ball(craft,C.cyan,side*.226,-.11,-.70,.10,.09,.18,null,true);
  }
  k.bake(root);
  return t=>{
    const a=-.67+.22*Math.sin(t*.13);
    craft.position.set(11.36*Math.sin(a),.92+.16*Math.sin(t*.64),10.84*Math.cos(a));
    craft.rotation.set(.04*Math.sin(t*.7),a+1.42,.06*Math.sin(t*.5));
    root.updateMatrixWorld(true);
  };
}
