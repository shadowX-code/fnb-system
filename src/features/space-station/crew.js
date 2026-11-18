import { color as C, group, TAU } from "./modelKit.js";
import { AnimationMixer } from "three";

const SKINS=["#c78b65","#e2b38c","#a87151","#edc8a5"];
const HAIRS=["#42322f","#2d3039","#744d39","#51372c"];
const TEAMS={command:"#44768a",finance:"#69a59d",factory:"#e3973e",marketing:"#a18bbc"};

function buildFigure(k,parent,room,index) {
  const figure=group(parent); figure.userData.moving=true;
  // A small contact patch anchors moving feet without rebaking stationary hull shadows.
  k.ball(figure,"#a89b80",0,.038,0,.43,.015,.27);
  const body=group(figure,0,.54,0);
  const cloth=TEAMS[room.id], skin=SKINS[(index+room.code.charCodeAt(0))%4], hair=HAIRS[(index+room.id.length)%4];
  k.soft(body,C.ink,0,.014,0,.32,.19,.24);
  k.soft(body,index===2 ? C.blue : cloth,0,.25,0,.38,.43,.24);
  k.box(body,C.panel,0,.28,.128,.12,.33,.025);
  k.box(body,C.gold,.122,.31,.128,.075,.055,.026);
  k.box(body,C.ink,0,.07,.005,.34,.075,.245);
  k.soft(body,C.gold,0,.071,.13,.068,.049,.025);
  if(room.id==="finance" && index!==2) {
    k.soft(body,C.ink,0,.29,.152,.042,.22,.022);
  } else if(room.id==="factory" && index!==2) {
    k.soft(body,C.blue,0,.18,.135,.21,.24,.029);
    for(const side of [-1,1]) k.box(body,C.blue,side*.083,.34,.125,.04,.14,.04);
  } else if(room.id==="marketing" && index!==2) {
    k.box(body,C.ink,0,.27,.142,.032,.26,.029,[0,0,-.42]);
    k.soft(body,C.gold,.059,.163,.15,.08,.082,.023);
  }
  k.drum(body,skin,0,.49,0,.13,.155,.13);
  const head=group(body,0,.685,0);
  k.ball(head,skin,0,0,0,.395,.427,.36);
  k.ball(head,hair,0,.085,-.037,.41,.30,.355);
  k.ball(head,hair,-.119,.088,.10,.15,.134,.107,[0,0,-.45]);
  for (const s of [-1,1]) {
    k.ball(head,skin,s*.19,-.007,0,.07,.10,.06);
    k.ball(head,C.ink,s*.087,.003,.161,.033,.048,.021);
    k.ball(head,C.white,s*.087-.005,.012,.172,.010,.011,.008);
    k.box(head,hair,s*.09,.039,.16,.06,.013,.016,[0,0,s*.09]);
  }
  k.ball(head,skin,0,-.046,.173,.056,.049,.046);
  k.box(head,"#935e51",0,-.089,.157,.051,.012,.012);
  if(room.id==="factory" && index!==2) {
    k.ball(head,C.orange,0,.125,-.012,.43,.265,.392);
    k.soft(head,C.gold,0,.096,.03,.48,.065,.42);
    k.box(head,C.cream,0,.225,0,.05,.035,.26);
  } else if(index===2 || room.id==="command") {
    k.ball(head,C.blue,0,.15,-.02,.41,.208,.35);
    k.soft(head,C.ink,0,.10,.13,.33,.045,.20);
    k.box(head,C.gold,0,.151,.157,.064,.047,.016);
  } else if(room.id==="marketing") {
    k.part(head,"ring",C.ink,0,.067,0,.407,.42,.70);
    for(const s of [-1,1]) k.soft(head,C.violet,s*.207,.012,0,.067,.14,.13);
    k.ball(head,hair,0,.068,-.161,.25,.23,.20);
  } else {
    for (const s of [-1,1]) k.part(head,"ring",C.ink,s*.09,.004,.175,.115,.108,.28);
    k.box(head,C.ink,0,.012,.18,.07,.012,.016);
  }
  const limbs=[-1,1].map(side=>{
    const arm=group(body,side*.229,.39,0), elbow=group(arm,0,-.19,0);
    k.ball(arm,cloth,0,-.080,0,.145,.245,.15);
    k.soft(elbow,skin,0,-.083,0,.094,.19,.10);
    k.ball(elbow,skin,0,-.175,.008,.119,.119,.112);
    const hip=group(body,side*.097,0,0), knee=group(hip,0,-.24,0);
    k.soft(hip,C.blue,0,-.105,0,.144,.265,.161);
    k.soft(knee,C.ink,0,-.102,0,.13,.232,.142);
    const foot=group(knee,0,-.235,0);
    k.soft(foot,C.black,0,-.012,.037,.157,.105,.239);
    k.box(foot,C.seam,0,-.053,.035,.148,.023,.225);
    return { arm, elbow, hip, knee, foot };
  });
  return {figure,body,head,limbs};
}

export function populate(k,base,room,roomIndex) {
  const walkers=[];
  return ["specialist","operator","visitor"].map((id,index)=>{
    const pilot=room.id==="factory" && id==="specialist";
    const {figure,body,head,limbs}=pilot ? {figure:group(base)} : buildFigure(k,base,room,index);
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
    const presence={position:figure.position,resting:false};
    if(!seated) walkers.push(presence);
    let work=0;
    let mixer, clips, activeClip, pilotScene, pilotState="Inspect";
    function playPilot(dt) {
      if(!mixer) return;
      const next=clips[pilotState];
      if(next!==activeClip) {
        next.reset().play();
        if(activeClip) next.crossFadeFrom(activeClip,.16,false);
        else if(pilotState==="Inspect") next.time=1.38;
        activeClip=next;
      }
      // Use the scheduler's travelled distance as the walk cycle clock.
      if(pilotState==="Walk") {
        next.paused=true;
        next.time=(travelled/.61%1)*next.getClip().duration;
      }
      mixer.update(dt);
    }
    function attachPilot(gltf) {
      pilotScene=gltf.scene;
      figure.add(pilotScene);
      mixer=new AnimationMixer(pilotScene);
      clips=Object.fromEntries(gltf.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
      playPilot(0);
    }
    function disposePilot() {
      if(mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(pilotScene);
      }
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
          if (dist>0) { figure.position.x+=step*dx/dist; figure.position.z+=step*dz/dist; }
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
      if(pilot) {
        pilotState=aligned ? "Inspect" : partner ? "Discuss" : stride>0 ? "Walk" : "Idle";
        playPilot(dt);
        return;
      }
      const gait=travelled*TAU/.61;
      work+=(Number(seated || (!visitor && pause>0 && !partner))-work)*(1-Math.exp(-dt*4));
      body.position.y=seated ? .57 : .51+.012*Math.cos(gait*2)*stride;
      body.rotation.x=seated ? .08+.025*Math.sin(t+phase) : .042*stride;
      head.rotation.y=.14*Math.sin(t*.81+phase)+.07*Math.sin(t*1.9+phase);
      head.rotation.x=.045*Math.sin(t*1.1+phase)+work*.07;
      limbs.forEach(({arm,elbow,hip,knee,foot},i)=>{
        const cycle=gait+i*Math.PI, wave=Math.sin(cycle);
        if (seated) { hip.rotation.x=-1.41; knee.rotation.x=1.45; }
        else {
          const footZ=wave*.143*stride, lift=Math.max(0,Math.cos(cycle))*.075*stride;
          const height=body.position.y-.061-lift;
          const bend=2*Math.acos(Math.min(1,Math.hypot(height,footZ)/.475));
          hip.rotation.x=-Math.atan2(footZ,height)-bend*.5; knee.rotation.x=bend;
        }
        foot.rotation.x=-hip.rotation.x-knee.rotation.x;
        const talk=partner ? .25*(1+Math.sin(t*2+phase)) : 0;
        arm.rotation.x=wave*.52*stride-work*.50-talk*(i===1 ? 1 : .3);
        arm.rotation.z=(i ? 1 : -1)*(.07+work*.07);
        elbow.rotation.x=-.16-work*(.68+.19*Math.sin(t*(seated ? 4.8 : 2.1)+phase+i))-talk;
      });
    }
    tick(0,.03);
    return pilot ? { id, anchor:figure, tick, attachPilot, disposePilot } : { id, anchor:figure, tick };
  });
}
