import {
  AnimationMixer, DataTexture, DynamicDrawUsage, InstancedMesh, LinearFilter, Matrix4,
  MeshBasicMaterial, PlaneGeometry, Quaternion, Sphere, Vector3,
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

// Stops are in cabin-local metres. The gaze target is the instrument or colleague
// at that stop. Separate port and starboard aisles keep the two silhouettes apart.
function stop(x,z,lookX,lookZ,activity,seconds) {
  return {x,z,lookX,lookZ,activity,seconds};
}
const rounds={
  command:{
    specialist:[stop(2.08,.90,.15,.03,"Discuss",2.9),stop(3.16,.45,3.30,-.55,"Device",4.3),stop(1.86,-.51,.99,-2.67,"Idle",2.2)],
    visitor:[stop(-2.90,1.48,.15,.03,"Idle",1.6),stop(-1.95,1.00,2.08,.90,"Device",2.8),stop(-1.97,.06,-1.23,-.59,"Discuss",3.5)],
  },
  finance:{
    specialist:[stop(2.35,-.13,1.53,-1.38,"Device",4.6),stop(1.53,.77,.05,-2.17,"Idle",2.2),stop(.38,.47,-.49,1.25,"Idle",3.0)],
    visitor:[stop(-2.31,1.04,-1.23,-.59,"Device",2.6),stop(-.49,1.25,.38,.47,"Idle",3.4),stop(-.46,.12,-1.23,-.59,"Discuss",3.6)],
  },
  factory:{
    specialist:[stop(.69,-.23,1.10,.02,"Inspect",4.2),stop(.63,.78,-.38,1.34,"Idle",2.7),stop(2.21,.86,2.08,-.91,"Idle",2.2)],
    visitor:[stop(-2.16,.86,-2.51,-1.01,"Idle",2.1),stop(-1.52,1.30,-1.23,-.59,"Device",3.2),stop(-.38,1.34,.63,.78,"Idle",2.8)],
  },
  marketing:{
    specialist:[stop(1.43,.47,1.75,-.40,"Device",3.1),stop(.79,.65,-.12,1.44,"Idle",2.1),stop(.18,-.25,1.35,-2.10,"Discuss",3.3)],
    visitor:[stop(-2.31,.99,-1.23,-.59,"Idle",2.8),stop(-1.24,1.54,2.04,-1.54,"Device",2.3),stop(-.12,1.44,.79,.65,"Idle",3.9)],
  },
};
const initialHolds=[[2.8,.45],[1.25,2.9],[2.42,.0],[.0,1.3]];
const inspectionYaw=.58;

function crewPaint(shader) {
  shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>", `
    #include <map_fragment>
    float inkValue = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    diffuseColor.rgb = max(vec3(0.), mix(vec3(inkValue), diffuseColor.rgb, 1.09));
    diffuseColor.rgb *= mix(.80, 1.18, smoothstep(.045, .55, inkValue));
  `);
}

export function populate(kit,base,room,roomIndex) {
  const shadows=contactShadows(kit,base);
  const occupants=[];
  return ["specialist","operator","visitor"].map((id,index)=>{
    const pilot=room.id==="factory" && id==="specialist";
    const seated=id==="operator", visitor=id==="visitor";
    const figure=group(base);
    figure.userData.moving=true;
    // Keyboard and switch heights are part of the authored poses.
    const scale=seated || pilot ? 1 : visitor ? 1.07 : 1.12;
    figure.scale.setScalar(scale);
    const route=rounds[room.id][id];
    let point=0, direction=1, visits=0;
    let pause=initialHolds[roomIndex][Number(visitor)], dwell=pause, travelled=0, speed=0;
    const start=seated ? {x:-1.23,z:-.59} : route[0];
    figure.position.set(start.x,0,start.z);
    shadows.update(index,start.x,start.z);
    const presence={position:figure.position,resting:true,seated};
    occupants.push(presence);
    let heading=seated ? Math.PI : pilot ? inspectionYaw : Math.atan2(start.lookX-start.x,start.lookZ-start.z);
    figure.rotation.y=heading;
    const costume=visitor ? (roomIndex%2 ? "Envoy" : "Liaison") : ROOM_COSTUMES[room.id][index];
    const phase=(roomIndex*2.63+index*1.34+.32)%6.28;
    const cadence=.89+.19*(.5+.5*Math.cos(phase*2.1));
    const cruise=(visitor ? .71 : .52)*cadence;
    let clock=phase, gaze=0;
    let scene, mixer, activeAction, actions, state=pilot ? "Inspect" : seated ? "Keyboard" : start.activity;
    let clonedSkeleton, portrait;
    const animatedPortrait=new Quaternion();

    function play(dt,lookOffset=0) {
      if(!mixer) return;
      const next=actions[state];
      if(next!==activeAction) {
        next.reset().play();
        if(activeAction) next.crossFadeFrom(activeAction,.22,false);
        else if(state==="Inspect") next.time=1.38;
        if(!pilot && state!=="Walk") {
          const offset=(phase/(2*Math.PI)+visits*.31)%1;
          next.time=offset*next.getClip().duration;
        }
        activeAction=next;
      }
      if(state==="Walk") {
        next.paused=true;
        next.time=((travelled/(.61*scale)+phase/(2*Math.PI))%1)*next.getClip().duration;
      } else if(seated) {
        // Alternate a typing burst with a brief read of the screen or a colleague.
        const beat=clock*(.52+roomIndex*.07)+phase;
        const reading=Math.max(0,Math.cos(beat)+.16*Math.sin(clock*.29+phase));
        next.timeScale=cadence*(1-.91*Math.min(1,reading));
      } else {
        next.timeScale=pilot ? 1 : cadence;
      }
      if(portrait) portrait.quaternion.copy(animatedPortrait);
      mixer.update(dt);
      if(portrait) {
        animatedPortrait.copy(portrait.quaternion);
        gaze+=(lookOffset-gaze)*(1-Math.exp(-dt*4.8));
        portrait.rotateY(gaze);
      }
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
        if(!node.isSkinnedMesh) return;
        if(node.name==="Crew_"+costume) {
          clonedSkeleton=node.skeleton;
          node.material.onBeforeCompile=crewPaint;
        } else discarded.push(node);
      });
      for(const node of discarded) {
        node.removeFromParent();
        node.skeleton.dispose();
      }
      if(!clonedSkeleton) throw new Error("Missing crew costume "+costume);
      const head=clonedSkeleton.getBoneByName("Portrait");
      head.scale.setScalar(seated ? 1.065 : 1.035);
      if(seated) {
        portrait=head;
        animatedPortrait.copy(head.quaternion);
      }
      mount(actor,gltf.animations);
    }
    let disposed=false;
    function disposePilot() {
      if(disposed) return;
      disposed=true;
      if(index===0) shadows.dispose();
      if(!mixer) return;
      mixer.stopAllAction();
      mixer.uncacheRoot(scene);
      scene.removeFromParent();
      clonedSkeleton?.dispose();
      mixer=null;
    }

    function tick(_time,dt) {
      clock+=dt;
      const pos=figure.position;
      const colleague=occupants.find(other=>other!==presence && other.resting && other.position.distanceToSquared(pos)<1.52);
      if(seated) {
        const toward=colleague ? Math.atan2(colleague.position.x-pos.x,colleague.position.z-pos.z)-heading : .17*Math.sin(clock*.54+phase);
        const angle=Math.atan2(Math.sin(toward),Math.cos(toward));
        play(dt,Math.max(-.58,Math.min(.58,angle)));
        return;
      }

      let targetAngle=heading;
      presence.resting=pause>0;
      if(presence.resting) {
        const station=route[point];
        const atPad=pilot && station.activity==="Inspect";
        const social=!atPad && colleague && (station.activity==="Discuss" || station.activity==="Idle");
        const lookX=social ? colleague.position.x : station.lookX;
        const lookZ=social ? colleague.position.z : station.lookZ;
        targetAngle=atPad ? inspectionYaw : Math.atan2(lookX-pos.x,lookZ-pos.z);
        // Two standing crew take turns. A seated partner acknowledges the speaker with a glance.
        const speaking=Math.floor((clock-phase)/(2.35+.13*roomIndex))%2===Number(visitor);
        state=social ? (colleague.seated || speaking ? "Discuss" : "Idle") : station.activity;
        // A presenter scans the instrument after pointing; a reader lowers the wrist between checks.
        if(!atPad && !social && pause<.26*dwell) state="Idle";
        if(atPad && Math.abs(Math.atan2(Math.sin(heading-targetAngle),Math.cos(heading-targetAngle)))>.03) state="Idle";
        else if(atPad) heading=inspectionYaw;
        pause=Math.max(0,pause-dt);
      } else {
        const next=route[point+direction];
        const dx=next.x-pos.x,dz=next.z-pos.z,dist=Math.hypot(dx,dz);
        targetAngle=Math.atan2(dx,dz);
        // Weight transfer into a turn before a new stride keeps the feet facing the route.
        const facing=Math.max(.10,Math.cos(targetAngle-heading));
        speed=Math.min(cruise*facing,speed+dt*.86,Math.sqrt(1.55*dist));
        const step=Math.min(dist,speed*dt);
        if(dist>0) {
          pos.x+=step*dx/dist;pos.z+=step*dz/dist;
          shadows.update(index,pos.x,pos.z);
        }
        travelled+=step;
        state="Walk";
        if(dist-step<.001) {
          point+=direction;
          if(point===0 || point===route.length-1) direction*=-1;
          visits++;
          dwell=route[point].seconds*(1+.24*Math.sin(visits*2.40+phase)+.12*Math.sin(visits*1.13-phase));
          pause=dwell;speed=0;
          pos.x=next.x;pos.z=next.z;
        }
      }
      heading+=Math.atan2(Math.sin(targetAngle-heading),Math.cos(targetAngle-heading))*(1-Math.exp(-dt*6.8));
      figure.rotation.y=heading;
      play(dt);
    }
    return { id, anchor:figure, tick, disposePilot, ...(pilot ? {attachPilot} : {attachCrew}) };
  });
}
