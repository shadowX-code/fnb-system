import * as T from "three";
import { group, instrumentTexture } from "./modelKit.js";

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
    screenTarget(screen, "factory", target);
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

// The embossed plinth is part of the Command cabin. Only its projected light moves.
export function orbitalProjector(k, cabin) {
  const g=group(cabin,.15,0,.03);
  const holo=group(g,0,1.82,0); holo.userData.moving=true;
  const map=document.createElement("canvas"); map.width=512;map.height=256;
  const ink=map.getContext("2d");
  const ocean=ink.createLinearGradient(0,0,0,256);
  ocean.addColorStop(0,"#1788d2");ocean.addColorStop(.56,"#07468f");ocean.addColorStop(1,"#1466a7");
  ink.fillStyle=ocean; ink.fillRect(0,0,512,256);
  ink.fillStyle="#259ee3";
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
    ink.closePath();ink.fill();ink.strokeStyle="#b4f9ff";ink.lineWidth=2.1;ink.stroke();
  }
  ink.strokeStyle="#65ddff";ink.lineWidth=1.4;
  for(let x=0;x<512;x+=32){ink.beginPath();ink.moveTo(x,0);ink.lineTo(x,256);ink.stroke();}
  for(let y=0;y<256;y+=24){ink.beginPath();ink.moveTo(0,y);ink.lineTo(512,y);ink.stroke();}
  const texture=new T.CanvasTexture(map);texture.colorSpace=T.SRGBColorSpace;
  const glass=new T.MeshBasicMaterial({map:texture,transparent:true,opacity:.96});
  glass.onBeforeCompile=shader=>{
    shader.vertexShader="varying float vProjectorEdge;\n"+shader.vertexShader.replace("#include <project_vertex>", `
      #include <project_vertex>
      vProjectorEdge = pow(1.0 - abs(normalize(normalMatrix * normal).z), 1.8);
    `);
    shader.fragmentShader="varying float vProjectorEdge;\n"+shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.30, .90, 1.), vProjectorEdge);
    `);
  };
  const world=new T.Mesh(new T.SphereGeometry(.93,48,32),glass);
  holo.add(world);
  k.part(holo,"ring","#6bdeec",0,0,0,1.99,1.99,.21,[1.07,0,-.28],true);
  return t=>{ holo.rotation.y=t*.17; holo.position.y=1.82+.043*Math.sin(t*1.5); };
}

function screenTarget(screen, room, target) {
  screen.geometry.computeBoundingBox();
  const bounds=screen.geometry.boundingBox;
  const size=bounds.getSize(new T.Vector3());
  size.z=Math.max(.08,size.z);
  target(screen,room,"screen",bounds.getCenter(new T.Vector3()).toArray(),size.toArray());
}

// Reparent the authored rooms under the existing camera, simulation and picking sockets.
export function mountDepartmentCabins(model, roots, target, motions, releases) {
  for(const id of ["finance","marketing","command"]) {
    const prefix=id[0].toUpperCase()+id.slice(1);
    const root=roots.get(id);
    const cabin=model.getObjectByName(prefix+"Cabin");
    const screen=cabin?.getObjectByName(prefix+"Display");
    const mural=cabin?.getObjectByName(prefix+"Mural");
    if(!screen?.geometry?.attributes.uv || !mural?.geometry) throw new Error("Missing cabin or instrument surface for "+id);
    root.add(cabin);
    screenTarget(screen,id,target);
    screenTarget(mural,id,target);
    const display=instrumentTexture(id);
    display.flipY=false;
    const material=new T.MeshBasicMaterial({map:display});
    screen.material=material;
    releases.push(()=>{display.dispose();material.dispose();});
    const ctx=display.image.getContext("2d");
    const cameraHead=cabin.getObjectByName("MarketingCameraHead");
    const restHeading=cameraHead?.rotation.y ?? 0;
    let last=-1;
    motions.push({root,updates:[time=>{
      if(cameraHead) cameraHead.rotation.y=restHeading+.22*Math.sin(time*.36);
      const column=Math.floor((Math.sin(time*.72)+1)*15);
      if(last===column) return;
      last=column;
      ctx.fillStyle="#25415a";ctx.fillRect(282,218,174,4);
      ctx.fillStyle=id==="marketing" ? "#e1b9fa" : "#95f4f7";
      ctx.fillRect(282+column*5,218,22,4);display.needsUpdate=true;
    }]});
  }
}
