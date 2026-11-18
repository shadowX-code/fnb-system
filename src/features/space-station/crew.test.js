import { expect, it } from "vitest";
import { Group } from "three";
import { populate } from "./crew.js";
import { rooms } from "./departments.js";

it("keeps the console seats, inspection pad and walking lanes aligned over successive rounds", () => {
  const kit={};
  for(const [index,room] of rooms.entries()) {
    const figures=populate(kit,new Group(),room,index);
    const [specialist,operator,visitor]=figures.map(figure=>figure.anchor);
    const seat=operator.position.clone();
    let closest=Infinity, onSwitch=false, inspections=0;
    for(let frame=0;frame<90*24;frame++) {
      for(const figure of figures) figure.tick(frame/24,1/24);
      closest=Math.min(closest,visitor.position.distanceTo(specialist.position),
        visitor.position.distanceTo(seat),specialist.position.distanceTo(seat));
      if(room.id==="factory") {
        const aligned=Math.hypot(specialist.position.x-.69,specialist.position.z+.23)<.001 &&
          Math.abs(specialist.rotation.y-.58)<.001;
        if(aligned && !onSwitch) inspections++;
        onSwitch=aligned;
      }
    }
    expect(operator.position.toArray()).toEqual([-1.23,0,-.59]);
    expect(operator.rotation.y).toBe(Math.PI);
    expect(closest).toBeGreaterThan(.75);
    if(room.id==="factory") expect(inspections).toBeGreaterThanOrEqual(2);
    for(const figure of figures) figure.disposePilot();
  }
});
