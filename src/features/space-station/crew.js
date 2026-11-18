import {
  AnimationMixer, DataTexture, DynamicDrawUsage, InstancedMesh, LinearFilter, Matrix4,
  MeshBasicMaterial, PlaneGeometry, Sphere, Vector3,
} from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { group } from "./modelKit.js";

const ROOM_COSTUMES={
  command:["Commander","Officer"],
  finance:["Analyst","Controller"],
  factory:[null,"Engineer"],
  marketing:["Producer","Editor"],
};

// One feathered contact pass per cabin follows moving feet, including on the frozen reduced-motion frame.
const shadowPaintByKit=new WeakMap();

function contactShadows(kit,base) {
  let paint=shadowPaintByKit.get(kit);
  if (!paint) {
    const size=32, rgba=new Uint8Array(size*size*4);
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const r=Math.hypot(2*(x+.5)/size-1,2*(y+.5)/size-1);
      const alpha=Math.max(0,1-r*r);
      rgba.set([255,255,255,Math.round(255*alpha*alpha)],4*(y*size+x));
    }
    const map=new DataTexture(rgba,size,size);
    map.magFilter=map.minFilter=LinearFilter; map.needsUpdate=true;
    const geometry=new PlaneGeometry(1,1).rotateX(-Math.PI/2);
    const material=new MeshBasicMaterial({map,color:"#593c34",transparent:true,opacity:.39,
      depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    paint={geometry,material,map,rooms:0};
    shadowPaintByKit.set(kit,paint);
  }
  paint.rooms++;
  const batch=new InstancedMesh(paint.geometry,paint.material,3);
  batch.name="Crew contact shadows";
  batch.boundingSphere=new Sphere(new Vector3(),3.3);
  batch.instanceMatrix.setUsage(DynamicDrawUsage);
  base.add(batch);
  const matrix=new Matrix4();
  return {
    update(index,x,z) {
      matrix.makeScale(.67,1,.43).setPosition(x,.011,z+.026);
      batch.setMatrixAt(index,matrix);
      batch.instanceMatrix.needsUpdate=true;
    },
    dispose() {
      batch.removeFromParent();batch.dispose();
      if (--paint.rooms===0) {
        paint.geometry.dispose();paint.material.dispose();paint.map.dispose();
        shadowPaintByKit.delete(kit);
      }
    },
  };
}

export function populate(kit,base,room,roomIndex) {
  const shadows=contactShadows(kit,base);
  const walkers=[];
  return ["specialist","operator","visitor"].map((id,index)=>{
    const pilot=room.id==="factory" && id==="specialist";
    const figure=group(base);
    figure.userData.moving=true;
    const seated=index===1, visitor=index===2, command=room.id==="command";
    const route=visitor ? [[-2.14,1.32],[.15,1.57],[1.69,1.47]] :
      command ? [[1.74,.84],[1.97,-.12],[2.05,-.78]] :
      [[1.58,.90],[.65,.80],[.69,room.id==="finance" ? -.77 : -.23]];
    const phase=1.7*roomIndex+index*2.49;
    let point=(roomIndex+index)%route.length, direction=point===route.length-1 ? -1 : 1;
    let pause=.45+((roomIndex*3+index*5)%8)*.41, travelled=0, speed=0, heading=seated ? Math.PI : -.5;
    // The specialist starts beside the physical inspection switch, then rejoins the round.
    const inspectionYaw=.58;
    if(pilot) {heading=inspectionYaw; pause=7;}
    const start=seated ? [-1.23,-.59] : route[point];
    figure.position.set(start[0],0,start[1]);
    shadows.update(index,start[0],start[1]);
    const presence={position:figure.position,resting:false};
    if(!seated) walkers.push(presence);
    const costume=visitor ? (roomIndex%2 ? "Envoy" : "Liaison") : ROOM_COSTUMES[room.id][index];
    let scene, mixer, activeAction, actions, state=pilot ? "Inspect" : seated ? "Keyboard" : "Idle";
    let clonedSkeleton;
    function play(dt) {
      if (!mixer) return;
      const next=actions[state];
      if (next!==activeAction) {
        next.reset().play();
        if (activeAction) next.crossFadeFrom(activeAction,.16,false);
        else if (state==="Inspect") next.time=1.38;
        else if (!pilot) next.time=(phase%1)*next.getClip().duration;
        activeAction=next;
      }
      if (state==="Walk") {
        next.paused=true;
        next.time=(travelled/.61%1)*next.getClip().duration;
      }
      mixer.update(dt);
    }
    function mount(model,clips) {
      scene=model;
      figure.add(scene);
      mixer=new AnimationMixer(scene);
      actions=Object.fromEntries(clips.map(clip=>[clip.name,mixer.clipAction(clip)]));
      play(0);
    }
    function attachPilot(gltf) {
      mount(gltf.scene,gltf.animations);
    }
    function attachCrew(gltf) {
      // Each actor owns its animated skeleton. All actors share the original paint and garment buffers.
      const actor=clone(gltf.scene);
      const discarded=[];
      actor.traverse(node=>{
        if (!node.isSkinnedMesh) return;
        if (node.name==="Crew_"+costume) clonedSkeleton=node.skeleton;
        else discarded.push(node);
      });
      for (const node of discarded) {
        node.removeFromParent();
        node.skeleton.dispose();
      }
      if (!clonedSkeleton) throw new Error("Missing crew costume "+costume);
      mount(actor,gltf.animations);
    }
    let disposed=false;
    function disposePilot() {
      if (disposed) return;
      disposed=true;
      if (index===0) shadows.dispose();
      if (!mixer) return;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      scene.removeFromParent();
      clonedSkeleton?.dispose();
      mixer=null;
    }
    function tick(t,dt) {
      let stride=0, targetAngle=heading;
      if (!seated) {
        if (pause>0) {
          pause-=dt;
          targetAngle=visitor ? (direction>0 ? 1.28 : -1.32) : room.id==="marketing" ? 1.9 : 2.83;
        } else {
          const next=route[point+direction];
          const dx=next[0]-figure.position.x,dz=next[1]-figure.position.z,dist=Math.hypot(dx,dz);
          const cruise=visitor ? .65 : .43;
          speed=Math.min(cruise,speed+dt*.88,Math.sqrt(1.6*dist));
          const step=Math.min(dist,speed*dt);
          if (dist>0) {
            figure.position.x+=step*dx/dist; figure.position.z+=step*dz/dist;
            shadows.update(index,figure.position.x,figure.position.z);
          }
          travelled+=step; stride=speed/cruise; targetAngle=Math.atan2(dx,dz);
          if (dist<.012) {
            point+=direction; if(point===0 || point===route.length-1) direction*=-1;
            pause=(visitor ? 1.65 : 3.45)+1.22*(1+Math.sin(phase+point+t*.13)); speed=0;
          }
        }
      }
      presence.resting=!seated && pause>0;
      const partner=presence.resting && walkers.find(other=>other!==presence && other.resting && other.position.distanceTo(figure.position)<1.16);
      if(partner) targetAngle=Math.atan2(partner.position.x-figure.position.x,partner.position.z-figure.position.z);
      const atPad=pilot && point===route.length-1 && presence.resting && !partner;
      if(atPad) targetAngle=inspectionYaw;
      heading+=Math.atan2(Math.sin(targetAngle-heading),Math.cos(targetAngle-heading))*(1-Math.exp(-dt*7));
      const aligned=atPad && Math.abs(Math.atan2(Math.sin(heading-inspectionYaw),Math.cos(heading-inspectionYaw)))<.03;
      if(aligned) heading=inspectionYaw;
      figure.rotation.y=heading;
      state=aligned ? "Inspect" : seated ? "Keyboard" : partner ? "Discuss" :
        stride>0 ? "Walk" : !pilot && !visitor && presence.resting ? "Device" : "Idle";
      play(dt);
    }
    tick(0,.03);
    return { id, anchor:figure, tick, disposePilot, ...(pilot ? {attachPilot} : {attachCrew}) };
  });
}
