import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export const color = {
  ink: "#182b3c", hull: "#cedae0", blue: "#435e74", seam: "#738695", cream: "#f4dfb7",
  panel: "#fff1cf", floor: "#d6be9d", rust: "#b6602e", orange: "#fb9b38", gold: "#f8cf70",
  cyan: "#68e6ed", glass: "#235169", white: "#fff9e8", black: "#1f2932", violet: "#9770d5",
};
export const TAU = Math.PI * 2;
export function group(parent, x = 0, y = 0, z = 0) {
  const g = new T.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Build rigid body parts as transforms. Repeated parts share geometry, material and a draw call.
// Only moving instance matrices are uploaded after the initial bake.
export function createKit(scene) {
  const geo = {
    block: new T.BoxGeometry(), soft: new RoundedBoxGeometry(1, 1, 1, 1, 0.12),
    ball: new T.SphereGeometry(0.5, 12, 9), drum: new T.CylinderGeometry(0.5, 0.5, 1, 20),
    taper: new T.CylinderGeometry(0.43, 0.5, 1, 16), oct: new T.CylinderGeometry(0.5, 0.5, 1, 8),
    ring: new T.TorusGeometry(0.5, 0.035, 6, 36), leaf: new T.SphereGeometry(0.5, 6, 5),
  };
  const painted = new T.MeshStandardMaterial({ roughness: 0.78, metalness: 0.1 });
  const luminous = new T.MeshBasicMaterial();
  const batches = [];
  const target = new T.Vector3();
  const localUp = new T.Vector3(0, 1, 0);

  function part(parent, shape, tint, x, y, z, w, h, d, angles, glow = false) {
    const node = new T.Object3D();
    node.position.set(x, y, z);
    node.scale.set(w, h, d);
    if (angles) node.rotation.set(...angles);
    node.userData.part = { shape, tint, glow };
    parent.add(node);
    return node;
  }
  function beam(parent, a, b, thickness, tint, square = false) {
    const v = target.set(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
    const node = part(parent, square ? "block" : "drum", tint, (a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2, thickness, v.length(), thickness);
    node.quaternion.setFromUnitVectors(localUp, v.normalize());
    return node;
  }
  function bake(root) {
    root.updateWorldMatrix(true, true);
    const sets = new Map();
    root.traverse(node => {
      if (!node.userData.part) return;
      const { shape, glow } = node.userData.part;
      let ancestor = node, moving = false;
      while (ancestor !== root) {
        if (ancestor.userData.moving) moving = true;
        ancestor = ancestor.parent;
      }
      const key = [shape, glow, moving].join("/");
      if (!sets.has(key)) sets.set(key, { shape, glow, moving, nodes: [] });
      sets.get(key).nodes.push(node);
    });
    const inverse = root.matrixWorld.clone().invert();
    const matrix = new T.Matrix4();
    for (const { shape, glow, moving, nodes } of sets.values()) {
      const batch = new T.InstancedMesh(geo[shape], glow ? luminous : painted, nodes.length);
      nodes.forEach((node, i) => {
        batch.setMatrixAt(i, matrix.multiplyMatrices(inverse, node.matrixWorld));
        batch.setColorAt(i, new T.Color(node.userData.part.tint));
      });
      if (moving) {
        batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
        batch.frustumCulled = false;
      }
      batch.castShadow=!moving && !glow; batch.receiveShadow=!glow;
      root.add(batch);
      if (!moving) nodes.forEach(node=>node.removeFromParent());
      batches.push({ root, batch, nodes: moving ? nodes : null, inverse, matrix });
    }
  }
  function update(activeRoom) {
    for (const { root, batch, nodes, inverse, matrix } of batches) {
      if (!nodes || (activeRoom && root.name!==activeRoom)) continue;
      nodes.forEach((node, i) => batch.setMatrixAt(i, matrix.multiplyMatrices(inverse, node.matrixWorld)));
      batch.instanceMatrix.needsUpdate = true;
    }
  }
  function dispose() {
    batches.forEach(({ batch }) => batch.dispose());
    const geometries = new Set(Object.values(geo)), materials = new Set([painted, luminous]), textures = new Set();
    scene.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.material) materials.add(node.material);
    });
    materials.forEach(material => { if (material.map) textures.add(material.map); material.dispose(); });
    textures.forEach(texture => texture.dispose());
    geometries.forEach(geometry => geometry.dispose());
  }
  return { part, beam, bake, update, dispose, box: (p, ...v) => part(p, "block", ...v), soft: (p, ...v) => part(p, "soft", ...v), drum: (p, ...v) => part(p, "drum", ...v), ball: (p, ...v) => part(p, "ball", ...v) };
}

// The texture lives on the physical monitor. Separate displays share this small atlas of instruments.
export function instrumentTexture(kind) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 240;
  const c = canvas.getContext("2d");
  const accent = { command: "#73eeff", finance: "#60e6c2", factory: "#ffbc5f", marketing: "#d6a4ff" }[kind];
  c.fillStyle = kind === "marketing" ? "#362b58" : "#102e44"; c.fillRect(0, 0, 512, 240);
  c.fillStyle = accent; c.fillRect(0, 0, 7, 240);
  c.font = "bold 22px system-ui"; c.fillText({ command: "ORBITAL TELEMETRY", finance: "FINANCIAL ANALYSIS", factory: "ASSEMBLY CONTROL", marketing: "STUDIO  /  STORYBOARD" }[kind], 22, 36);
  c.fillStyle = "#91afc0"; c.font = "14px monospace"; c.fillText("FEEDX    /    SIMULATION", 23, 62);
  c.strokeStyle = "#385367"; c.lineWidth = 1;
  for (let i=0;i<5;i++) { c.beginPath(); c.moveTo(22,84+26*i); c.lineTo(482,84+26*i); c.stroke(); }
  c.fillStyle = accent;
  if (kind === "marketing") {
    for (let i=0;i<3;i++) {
      c.fillStyle = ["#bfa1e2","#eac19b","#8ac4cb"][i]; c.fillRect(23+157*i,85,142,94);
      c.fillStyle = ["#655083","#a96551","#437683"][i]; c.beginPath(); c.arc(83+157*i,124,25,0,TAU); c.fill();
      c.fillStyle = "#e6cdee"; c.fillRect(23+157*i,191,109-i*19,6);
    }
  } else if (kind === "command") {
    c.strokeStyle=accent; c.lineWidth=2;
    for (let i=0;i<3;i++) { c.beginPath(); c.ellipse(143,148,91,20+i*13,-.25,0,TAU); c.stroke(); }
    c.beginPath(); c.arc(143,148,27,0,TAU); c.fill();
    c.fillStyle="#d5fff0"; c.beginPath(); c.arc(215,110,5,0,TAU); c.fill();
    c.fillStyle=accent; c.font="bold 15px monospace"; c.fillText("ORBIT TRACK",287,112);
    for(let i=0;i<4;i++) c.fillRect(287,137+i*17,68+(i*33)%103,5);
  } else if (kind === "factory") {
    c.strokeStyle=accent; c.lineWidth=10; c.lineJoin="round";
    c.beginPath(); c.moveTo(70,199); c.lineTo(96,140); c.lineTo(165,98); c.lineTo(198,130); c.stroke();
    for(const [x,y] of [[70,199],[96,140],[165,98]]) {
      c.beginPath(); c.arc(x,y,10,0,TAU); c.fill(); c.fillStyle="#15354a"; c.beginPath(); c.arc(x,y,4,0,TAU); c.fill(); c.fillStyle=accent;
    }
    c.fillRect(41,206,81,8); c.font="bold 15px monospace"; c.fillText("AXIS POSITION",276,101);
    for(let i=0;i<4;i++) {c.fillStyle="#46616c";c.fillRect(278,123+i*22,180,7);c.fillStyle=accent;c.fillRect(278,123+i*22,64+(i*39)%91,7);}
  } else {
    for (let i=0;i<12;i++) { const h=22+((i*31)%67)+i*3; c.fillRect(24+i*19,212-h,13,h); }
    c.strokeStyle = accent; c.lineWidth = 4; c.beginPath();
    for (let i=0;i<15;i++) { const x=279+i*14,y=164-i*3+19*Math.sin(i*1.8); if (!i) c.moveTo(x,y); else c.lineTo(x,y); } c.stroke();
    c.fillRect(280,199,164,4);
  }
  const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
  return texture;
}
