import * as T from "three";
import { rooms, roomById } from "./departments.js";
import { createKit, group, color as C } from "./modelKit.js";
import { buildCabin, buildInfrastructure, mountFactoryJunction, serviceShuttle } from "./architecture.js";
import { furnish, bindFactoryWorkcell } from "./fittings.js";
import { populate } from "./crew.js";
import { stationArt } from "./stationArt.js";
import junctionUrl from "./assets/factory-junction.glb?url";
import workcellUrl from "./assets/factory-workcell.glb?url";
import technicianUrl from "./assets/technician.glb?url";

const clamp=T.MathUtils.clamp;
const OVERVIEW=[0,1.65,-1.35];
const POSITIONS={
  command:[.15,1.07,.03],finance:[1.55,.9,-1.36],factory:[1.7,1.22,-.84],marketing:[1.75,.9,-.40],
};

export function createStation(host, events) {
  const canvas=document.createElement("canvas");
  canvas.setAttribute("aria-label","Interactive three-dimensional space station");
  const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:"low-power"});
  const scene=new T.Scene(), camera=new T.OrthographicCamera(-1,1,1,-1,.1,95);
  const kit=createKit(scene);
  const art=stationArt();
  const remove=[];
  function listen(node,name,fn,options) {
    node.addEventListener(name,fn,options); remove.push(()=>node.removeEventListener(name,fn,options));
  }
  const roomRoots=new Map(), targets=[], crew=[], motions=[];
  const targetMaterial=new T.MeshBasicMaterial({visible:false});
  const unit=new T.BoxGeometry();
  const target=(parent,room,id,at,size)=>{
    const mesh=new T.Mesh(unit,targetMaterial); mesh.position.set(...at); mesh.scale.set(...size);
    mesh.userData.pick={room,id}; parent.add(mesh); targets.push(mesh);
    return mesh;
  };
  let frame=0,alive=true,drawable=true,ready=false,artReady=false,previous=0,time=0,width=1,height=1,settled=false;
  let focused=null, selected=null,hovered=null, paused=matchMedia("(prefers-reduced-motion: reduce)").matches;
  const naturalRatio=Math.min(window.devicePixelRatio||1,1.6);
  let ratio=naturalRatio, slowFrames=0,qualitySteps=0;
  let zoom=1, desiredZoom=1, view=0,desiredYaw=.135,yaw=.135, desiredPitch=.58,pitch=.58;
  const center=new T.Vector3(...OVERVIEW), toCenter=center.clone(), pointer=new T.Vector2(), ray=new T.Raycaster();
  const tmp=new T.Vector3(), color=new T.Color();
  let pointerDown=null, dragging=false, mouse=null, needsPick=false;
  const labels=new Map();

  function schedule() {
    if (!frame && alive && drawable && !document.hidden) frame=requestAnimationFrame(draw);
  }
  function dispose() {
    if (!alive) return;
    alive=false; cancelAnimationFrame(frame);
    for(const stop of remove.reverse()) stop();
    for(const {figures} of crew) for(const figure of figures) figure.disposePilot?.();
    art.dispose();
    kit.dispose(); unit.dispose(); targetMaterial.dispose();
    scene.traverse(node=>node.shadow?.dispose());
    renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    for(const node of labels.values()) node.remove();
  }
  function failed() { if(alive) { dispose(); events.error("The 3D view stopped. You can still open your available workspaces."); } }
  let highlight, stars, shuttle, fill;
  try {
    host.prepend(canvas);
    renderer.setPixelRatio(ratio); renderer.setClearColor(0,0);
    renderer.shadowMap.enabled=true; renderer.shadowMap.type=T.PCFShadowMap;
    renderer.shadowMap.autoUpdate=false; renderer.shadowMap.needsUpdate=true;
    fill=new T.HemisphereLight("#fff2de","#9da9b5",1.76); scene.add(fill);
    const key=new T.DirectionalLight("#fff0d7",2.18); key.position.set(-8,15,8); key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);
    Object.assign(key.shadow.camera,{left:-15,right:15,top:14,bottom:-14,near:.1,far:48});
    key.shadow.camera.updateProjectionMatrix(); key.shadow.normalBias=.024; key.shadow.bias=-.00025;
    scene.add(key);
    const rim=new T.DirectionalLight("#add9fc",1.06); rim.position.set(6,6,-9); scene.add(rim);
    const orbit=group(scene); buildInfrastructure(kit,orbit,rooms); kit.bake(orbit);
    shuttle=serviceShuttle(kit,scene); shuttle(0);

    for(const [index, room] of rooms.entries()) {
      const root=group(scene,...room.at); root.name=room.id; roomRoots.set(room.id,root);
      if(room.id!=="factory") {
        buildCabin(kit,room,root);
        motions.push({root,updates:furnish(kit,root,room)});
      }
      const figures=populate(kit,root,room,index); crew.push({root,figures});
      const [sx,sy,sz]=room.hullScale;
      const factoryBay=room.id==="factory";
      target(root,room.id,null,[0,1.45*sy,0],[(factoryBay ? 7.85 : 7.2)*sx,(factoryBay ? 4.45 : 3.9)*sy,4.5*sz]);
      target(root,room.id,"equipment",POSITIONS[room.id],room.id==="finance" ? [1.83,1.64,1.04] : [1.56,2.2,1.31]);
      if(!factoryBay) target(root,room.id,"screen",[0,1.70,-1.98],[3.12,1.35,.22]);
      for (const fig of figures) target(fig.anchor,room.id,fig.id,[0,.71,0],[.58,1.53,.54]);
      kit.bake(root);
      const label=document.createElement("button"); label.type="button"; label.className="station-callout";
      label.style.setProperty("--cabin-color",room.accent); label.textContent=room.name;
      label.setAttribute("aria-label","Enter "+room.name); label.onclick=()=>events.enter(room.id);
      host.append(label); labels.set(room.id,label);
    }
    const factory=roomRoots.get("factory");
    // Light the recessed workbench from the practical lamps in the front pressure rib.
    const workLight=new T.PointLight("#ffd59a",7,5.5);
    workLight.position.set(-.45,2.68,.85);
    factory.add(workLight);
    const specialist=crew.find(({root})=>root===factory).figures.find(figure=>figure.id==="specialist");
    Promise.all([
      art.load(junctionUrl,model=>{
        mountFactoryJunction(model.scene,factory,orbit);
        const switchFace=factory.getObjectByName("InspectContact");
        target(switchFace,"factory","equipment",[0,-.045,0],[.32,.15,.24]);
      }),
      art.load(workcellUrl,({scene:workcell})=>{
        factory.add(workcell);
        const rig=bindFactoryWorkcell(workcell,target);
        motions.push({root:factory,updates:[rig.animate]});
        remove.push(rig.dispose);
      }),
      art.load(technicianUrl,model=>specialist.attachPilot(model)),
    ]).then(()=>{
      if(!alive) return;
      artReady=true;
      renderer.shadowMap.needsUpdate=true;
      schedule();
    }).catch(failed);
    const starGeometry=new T.BufferGeometry(), points=[];
    for (let i=0;i<125;i++) {
      const random=n=>{const a=Math.sin(n*127.1+311.7)*43758.5453;return a-Math.floor(a);};
      points.push((random(i+1)-.5)*68,random(i+180)*18-2,-16-random(i+350)*12);
    }
    starGeometry.setAttribute("position",new T.Float32BufferAttribute(points,3));
    stars=new T.Points(starGeometry,new T.PointsMaterial({color:"#b3d8e3",size:.036,transparent:true,opacity:.62,depthWrite:false}));
    scene.add(stars);
    highlight=new T.Mesh(new T.RingGeometry(.87,1,48),new T.MeshBasicMaterial({color:C.cyan,side:T.DoubleSide,transparent:true,opacity:.89,depthTest:false}));
    highlight.rotation.x=-Math.PI/2; highlight.renderOrder=5; highlight.visible=false; scene.add(highlight);
    const resize=new ResizeObserver(()=>{
      width=Math.max(1,host.clientWidth); height=Math.max(1,host.clientHeight);
      renderer.setSize(width,height,false); needsPick=true; schedule();
    });
    resize.observe(host); remove.push(()=>resize.disconnect());
    const visibility=new IntersectionObserver(entries=>{
      drawable=entries[0].isIntersecting;
      if (!drawable) {cancelAnimationFrame(frame);frame=0;previous=0;} else schedule();
    });
    visibility.observe(host); remove.push(()=>visibility.disconnect());
    listen(document,"visibilitychange",()=>{
      if(document.hidden) {cancelAnimationFrame(frame);frame=0;previous=0;} else schedule();
    });
    listen(canvas,"webglcontextlost",e=>{e.preventDefault();failed();});
    listen(canvas,"pointerdown",e=>{
      if(e.button!==0 || !e.isPrimary) return;
      pointerDown={x:e.clientX,y:e.clientY,lastX:e.clientX,lastY:e.clientY,id:e.pointerId};
      dragging=false; canvas.setPointerCapture(e.pointerId);
    });
    listen(canvas,"pointermove",e=>{
      mouse=[e.clientX,e.clientY]; needsPick=true; schedule();
      if(!pointerDown || pointerDown.id!==e.pointerId) return;
      dragging ||= Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)>5;
      if(dragging) {
        desiredYaw=clamp(desiredYaw-(e.clientX-pointerDown.lastX)*.005,-.52,.56);
        desiredPitch=clamp(desiredPitch+(e.clientY-pointerDown.lastY)*.0035,.31,.85);
        canvas.style.cursor="grabbing";
      }
      pointerDown.lastX=e.clientX; pointerDown.lastY=e.clientY;
    });
    listen(canvas,"pointerup",e=>{
      if(!pointerDown || pointerDown.id!==e.pointerId) return;
      if(!dragging) {
        const hit=pick(e.clientX,e.clientY);
        if(hit) focused ? events.select(hit.id) : events.enter(hit.room);
      }
      pointerDown=null; dragging=false; needsPick=true;
    });
    listen(canvas,"pointercancel",()=>{pointerDown=null;dragging=false;});
    listen(canvas,"pointerleave",()=>{mouse=null;hovered=null;schedule();});
    listen(canvas,"wheel",e=>{e.preventDefault();setZoom(desiredZoom*Math.exp(-clamp(e.deltaY,-80,80)*.0025));},{passive:false});
    schedule();
  } catch(error) { dispose(); throw error; }

  function pick(x,y) {
    const rect=canvas.getBoundingClientRect();
    pointer.set((x-rect.left)/width*2-1,-(y-rect.top)/height*2+1);
    ray.setFromCamera(pointer,camera);
    const available=targets.filter(obj=>focused ? obj.userData.pick.room===focused && obj.userData.pick.id : !obj.userData.pick.id);
    return ray.intersectObjects(available,false)[0]?.object.userData.pick;
  }
  function setZoom(value) {desiredZoom=clamp(value,.78,1.52);schedule();}
  function focus(id) {
    focused=id; selected=null; hovered=null; settled=false; mouse=null;
    const pos=id ? roomById[id].at : OVERVIEW;
    toCenter.set(pos[0],pos[1]+(id ? .99 : 0),pos[2]); desiredPitch=id ? .40 : .58;
    desiredYaw=id ? .12 : .135; desiredZoom=1;
    for(const label of labels.values()) label.hidden=!!id;
    schedule();
  }
  function draw(stamp) {
    frame=0;
    try {
      const elapsed=previous ? (stamp-previous)/1000 : 0; previous=stamp;
      if(ready && elapsed>.054 && elapsed<.45) slowFrames++; else slowFrames=Math.max(0,slowFrames-1);
      if(slowFrames>34 && qualitySteps<2) {
        qualitySteps++; ratio=Math.max(.65,ratio*.73); renderer.setPixelRatio(ratio); slowFrames=0;
        events.quality();
      }
      const dt=Math.min(elapsed,.065), weight=paused ? 1 : 1-Math.exp(-dt*5.8);
      if(!paused) time+=dt;
      center.lerp(toCenter,weight); yaw+=(desiredYaw-yaw)*weight; pitch+=(desiredPitch-pitch)*weight;
      zoom+=(desiredZoom-zoom)*weight; view+=((focused ? 1 : 0)-view)*weight;
      // Retain adjoining cabins and bridge endpoints while throttling their occupants.
      settled=Boolean(focused && view>.985);
      const aspect=width/height;
      // The port solar wing rises above the crown as the orbital plane turns edge-on.
      const orbitMargin=clamp(Math.abs(yaw-.135)/.42,0,1);
      const overviewHeight=Math.max(24.25+1.55*orbitMargin,(30.8+3.2*orbitMargin)/aspect);
      const roomHeight=Math.max(focused==="command" ? 7.45 : 6.95,(focused==="command" ? 12.5 : 9.5)/aspect);
      const half=T.MathUtils.lerp(overviewHeight,roomHeight,view)/(2*zoom);
      // Cut away an entire foreground cabin only when it would block the occupied deck.
      // A near-plane slice through a neighbouring shell leaves its open backfaces on screen.
      const cabin=roomById[focused];
      for(const [id,root] of roomRoots) {
        root.visible=true;
        if(!cabin || id===focused || view<.80) continue;
        const dx=root.position.x-cabin.at[0], dz=root.position.z-cabin.at[2];
        const across=dx*Math.cos(yaw)-dz*Math.sin(yaw), ahead=dx*Math.sin(yaw)+dz*Math.cos(yaw);
        root.visible=!(Math.abs(across)<6.9 && ahead>3.2);
      }
      camera.left=-half*aspect; camera.right=half*aspect; camera.top=half; camera.bottom=-half; camera.updateProjectionMatrix();
      camera.position.set(center.x+34*Math.sin(yaw)*Math.cos(pitch),center.y+34*Math.sin(pitch),center.z+34*Math.cos(yaw)*Math.cos(pitch));
      camera.lookAt(center); camera.updateMatrixWorld();
      if(!paused || !ready) {
        for(const {root,updates} of motions) if(!settled || root.name===focused) for(const animate of updates) animate(time);
        for(const {root,figures} of crew) if(!settled || root.name===focused) for(const actor of figures) actor.tick(time,dt);
        shuttle(time); fill.intensity=1.76+.045*Math.sin(time*.73);
        stars.rotation.y=.018*Math.sin(time*.08); stars.material.opacity=.62+.12*Math.sin(time*.63);
        for(const root of roomRoots.values()) if(!settled || root.name===focused) root.updateMatrixWorld(true);
        kit.update(settled ? focused : null);
      }
      if(!focused) for(const room of rooms) {
        const label=labels.get(room.id); tmp.set(room.at[0],room.at[1]-.30,room.at[2]+2.44*room.hullScale[2]).project(camera);
        label.style.left=((tmp.x+1)*50)+"%"; label.style.top=((1-tmp.y)*50)+"%";
      }
      if(mouse && !dragging && (needsPick || (focused && !paused))) {
        hovered=pick(...mouse); canvas.style.cursor=hovered ? "pointer" : "grab"; needsPick=false;
      }
      const active=hovered || (focused && selected ? {room:focused,id:selected} : null);
      highlight.visible=!!active;
      if(active) {
        const obj=targets.find(t=>t.userData.pick.room===active.room && t.userData.pick.id===active.id);
        if(obj) {
          obj.getWorldPosition(highlight.position); highlight.position.y=roomById[active.room].at[1]+.045;
          highlight.scale.set(active.id ? Math.max(.38,obj.scale.x*.55) : 3.90,active.id ? Math.max(.32,obj.scale.z*.57) : 2.44,1);
          highlight.material.color.copy(color.set(roomById[active.room].accent));
        }
      }
      renderer.render(scene,camera);
      if(!ready && artReady && width>1) {ready=true;events.ready();}
      if(!paused) schedule();
    } catch { failed(); }
  }
  return { dispose,focus,select:id=>{selected=id;hovered=null;mouse=null;schedule();},pause:value=>{paused=value;previous=0;schedule();},zoom:factor=>setZoom(desiredZoom*factor),
    orbit:step=>{desiredYaw=clamp(desiredYaw+step,-.52,.56);schedule();},reset:()=>focus(focused) };
}
