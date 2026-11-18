import * as T from "three";
import { instrumentTexture } from "./modelKit.js";
import { instrumentGlass } from "./instrumentGlass.js";

export { orbitalProjector } from "./projector.js";

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
  const clock = { value:0 };
  const glass = instrumentGlass("factory", display, screens[0], clock);
  for (const screen of screens) {
    screen.material = glass;
    screenTarget(screen, "factory", target);
  }

  // Four workcell lenses sit over the robots. They hand off the inspection
  // indication down the existing bank while the cabin practicals keep steady.
  workcell.traverse(node => {
    const lens = node.material;
    if (lens?.name !== "Illuminated lens") return;
    lens.onBeforeCompile = shader => {
      shader.uniforms.uInspectionTime = clock;
      shader.vertexShader = "varying float vBank;\n" + shader.vertexShader.replace("#include <begin_vertex>", `
        #include <begin_vertex>
        vBank = position.x < -2.4 ? 0. : position.x < -.5 ? 1. : position.x < 1. ? 2. : 3.;
      `);
      shader.fragmentShader = "varying float vBank; uniform float uInspectionTime;\n" +
        shader.fragmentShader.replace("#include <emissivemap_fragment>", `
          #include <emissivemap_fragment>
          float dwell = mod(uInspectionTime + vBank*1.45, 7.6);
          float lit = smoothstep(.20,.85,dwell) * (1.-smoothstep(2.7,3.7,dwell));
          totalEmissiveRadiance *= mix(vec3(.24,.15,.10), vec3(1.,.72,.38), lit);
        `);
    };
  });
  return {
    animate(time) {
      clock.value = time;
      turret.rotation.y = .09 * Math.sin(time * .5);
      fixture.rotation.y = -.07 * Math.sin(time * .5 + .8);
    },
    dispose() {
      glass.dispose();
      display.dispose();
    },
  };
}

// Separate the physical screen banks from the common print atlas. This keeps
// the same inked artwork and buffers while letting the glass emit by department.
const phosphor = {
  command: [.77, 1.72, 2.75],
  finance: [.81, 1.56, 1.72],
  marketing: [1.64, .95, 1.75],
};

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
    const printed=mural.material;
    const backlight=printed.clone();
    backlight.emissive.setRGB(...phosphor[id]);
    cabin.traverse(node=>{
      if(node!==mural && node.material===printed) node.material=backlight;
    });
    releases.push(()=>backlight.dispose());
    const clock={value:0};
    const glass=instrumentGlass(id,display,screen,clock);
    screen.material=glass;
    releases.push(()=>{display.dispose();glass.dispose();});
    // Marketing's campaign is a printed scenic backdrop. The edit monitor runs the shot list.
    if (id!=="marketing") {
      const wall=instrumentGlass(id,mural.material.map,mural,clock,true);
      mural.material=wall;
      releases.push(()=>wall.dispose());
    }
    const cameraHead=cabin.getObjectByName("MarketingCameraHead");
    const restHeading=cameraHead?.rotation.y ?? 0;
    motions.push({root,updates:[time=>{
      clock.value=time;
      if(cameraHead) {
        // Hold the shot between two short, eased reframing moves.
        const take=(time+1.4)%10.7;
        const pan=T.MathUtils.smoothstep(take,3.2,4.35)-T.MathUtils.smoothstep(take,7.0,9.05);
        cameraHead.rotation.y=restHeading-.12+pan*.33;
      }
    }]});
  }
}
