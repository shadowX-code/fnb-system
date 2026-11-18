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

export function buildInfrastructure(k, base) {
  const orbit=ringPlane(base);
  orbit.name="OrbitalRingPlane";
  function point(i, r, y) { const t=i*TAU/64; return [Math.sin(t)*r,y,Math.cos(t)*r]; }
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
  k.box(dock,C.hull,0,0,0,2.3,.4,1.1);
  for(const x of [-.78,.78]) {
    k.soft(dock,C.orange,x,.2,.13,.42,.37,.99);
    k.box(dock,C.ink,x,.38,.12,.30,.04,.45);
  }
}

// Each deck and its rails share one local +Z axis. Length is measured between
// the room berths, so a raised or shifted cabin still meets its gangway.
function seatSpan(model, mount, start, end, stockLength) {
  const [dx, dy, dz] = end.map((value, axis) => value - start[axis]);
  const span = group(mount, ...start.map((value, axis) => (value + end[axis]) / 2));
  span.rotation.order = "YXZ";
  span.rotation.y = Math.atan2(dx, dz);
  span.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
  span.scale.z = Math.hypot(dx, dy, dz) / stockLength;
  span.add(model);
}

const gangways = [
  ["BridgeCommandFinance", "command", "finance", 9.670301],
  ["BridgeCommandMarketing", "command", "marketing", 5.129329],
  ["BridgeCommandFactory", "command", "factory", 5.242224],
  ["BridgeFinanceFactory", "finance", "factory", 2.745735],
  ["BridgeFinanceMarketing", "finance", "marketing", 4.528489],
];

export function mountOrbitalKit(kit, infrastructure, rooms) {
  const byId = Object.fromEntries(rooms.map(room => [room.id, room]));
  const orbitalPlane = infrastructure.getObjectByName("OrbitalRingPlane");
  orbitalPlane.add(kit.getObjectByName("OrbitalBand"));
  for (const [name, from, to, stockLength] of gangways) {
    const a = byId[from], b = byId[to];
    seatSpan(kit.getObjectByName(name), infrastructure, berth(a,b), berth(b,a), stockLength);
  }
  orbitalPlane.updateMatrix();
  const [cx, cy, cz] = byId.command.at;
  for (const [side, name] of [[-1, "DockStayPort"], [1, "DockStayStarboard"]]) {
    const foot = new T.Vector3(side * .8, .22, 10.2).applyMatrix4(orbitalPlane.matrix);
    seatSpan(kit.getObjectByName(name), infrastructure,
      [cx + side * 2.2, cy - .65, cz - .78], foot.toArray(), 1);
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

// A slowly travelling clearance signal uses the existing emissive strips on the ring.
export function orbitalRunningLights(infrastructure) {
  const plane = infrastructure.getObjectByName("OrbitalRingPlane");
  const band = plane.getObjectByName("OrbitalBand");
  plane.updateWorldMatrix(true, false);
  const inverse = new T.Matrix4().copy(plane.matrixWorld).invert();
  const bearing = new T.Vector2(0, 1);
  const materials = new Set();
  band.traverse(mesh => { if (mesh.material?.emissiveMap) materials.add(mesh.material); });
  for (const material of materials) {
    material.onBeforeCompile = shader => {
      shader.uniforms.uRingInverse = {value:inverse};
      shader.uniforms.uBearing = {value:bearing};
      shader.vertexShader = "uniform mat4 uRingInverse; uniform vec2 uBearing; varying float vBeacon;\n" +
        shader.vertexShader.replace("#include <project_vertex>", `
          #include <project_vertex>
          vec4 orbitalPoint = vec4(transformed,1.);
          #ifdef USE_INSTANCING
            orbitalPoint = instanceMatrix * orbitalPoint;
          #endif
          vec2 radial = (uRingInverse * modelMatrix * orbitalPoint).xz;
          float cosine = dot(radial, uBearing) / max(length(radial), .001);
          vBeacon = smoothstep(8.4,9.4,length(radial)) * smoothstep(.87,.99,cosine);
        `);
      shader.fragmentShader = "varying float vBeacon;\n" +
        shader.fragmentShader.replace("#include <emissivemap_fragment>", `
          #include <emissivemap_fragment>
          totalEmissiveRadiance *= .76 + .96 * vBeacon;
        `);
    };
  }
  return time => bearing.set(Math.sin(.23*time+.82), Math.cos(.23*time+.82));
}
