import {
  BufferAttribute, BufferGeometry, Data3DTexture, LineBasicMaterial, LineSegments,
  LinearFilter, Matrix4, RGBAFormat,
} from "three";

const sockets = [
  ["command", ["CommandCabin"]],
  ["finance", ["FinanceCabin"]],
  ["factory", ["FactoryCorner", "FactoryWorkcell"]],
  ["marketing", ["MarketingCabin"]],
];

function lightCabin(base, probes, worldToCabin, slice) {
  const material = base.clone();
  const previous = base.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(base, shader, renderer);
    shader.uniforms.cabinProbes = { value: probes };
    shader.uniforms.worldToCabin = { value: worldToCabin };
    shader.uniforms.cabinSlice = { value: slice };
    shader.vertexShader = `uniform mat4 worldToCabin;
      varying vec3 vCabinProbe;
    ` + shader.vertexShader.replace("#include <project_vertex>", `
      #include <project_vertex>
      mat4 cabinFromMesh = worldToCabin * modelMatrix;
      // Sample just outside the painted face, on the lit side of the bulkhead.
      vec3 surface = (cabinFromMesh * vec4(transformed,1.)).xyz
                   + .13 * normalize(mat3(cabinFromMesh) * normal);
      vCabinProbe = (surface - vec3(-5.8,-1.,-3.35)) / vec3(11.6,5.5,6.7);
    `);
    shader.fragmentShader = `uniform highp sampler3D cabinProbes;
      uniform float cabinSlice;
      varying vec3 vCabinProbe;
    ` + shader.fragmentShader.replace("#include <aomap_fragment>", `
      #include <aomap_fragment>
      // Half-texel inset keeps trilinear filtering inside this room's 20 slices.
      vec3 grid = clamp(vCabinProbe,0.,1.) * vec3(31.,15.,19.) + .5;
      vec4 probe = texture(cabinProbes, (grid + vec3(0.,0.,cabinSlice)) / vec3(32.,16.,80.));
      reflectedLight.indirectDiffuse *= mix(vec3(.49,.40,.41), vec3(1.), probe.a);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * (1.-metalnessFactor) * probe.rgb * probe.rgb * 2.5;
    `);
  };
  material.customProgramCacheKey = () => base.customProgramCacheKey() + "-cabin-irradiance";
  return material;
}

// A stale or incomplete optional bake can fall back to the authored materials.
function decodeBake(bytes) {
  const size = 32 * 16 * 80 * 4;
  if (!bytes || bytes.byteLength < 4 + size) return;
  const header = new DataView(bytes);
  if (header.getUint32(0) !== 0x46584c31) return;
  let offset = 4 + size;
  const contours = [];
  for (let room = 0; room < sockets.length; room++) {
    if (offset + 4 > bytes.byteLength) return;
    const coordinates = header.getUint32(offset, true) * 6;
    offset += 4;
    if (offset + coordinates * 2 > bytes.byteLength) return;
    contours.push(new Int16Array(bytes, offset, coordinates));
    offset += coordinates * 2;
  }
  if (offset === bytes.byteLength) return { volume: new Uint8Array(bytes, 4, size), contours };
}

export function mountCabinLighting(bytes, roomRoots) {
  const bake = decodeBake(bytes);
  if (!bake) return;
  const probes = new Data3DTexture(bake.volume, 32, 16, 80);
  probes.format = RGBAFormat;
  probes.minFilter = probes.magFilter = LinearFilter;
  probes.needsUpdate = true;

  const ink = new LineBasicMaterial({ color: "#19263a", transparent: true, opacity: .42, depthWrite: false });
  ink.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
      #include <project_vertex>
      gl_Position.z -= .000012 * gl_Position.w;
    `);
  };
  const lines = [], finishes = [];
  for (const [index, [id, assemblies]] of sockets.entries()) {
    const room = roomRoots.get(id);
    room.updateWorldMatrix(true, false);
    const inverse = new Matrix4().copy(room.matrixWorld).invert();
    const byFinish = new Map();
    for (const name of assemblies) {
      room.getObjectByName(name).traverse(mesh => {
        const base = mesh.material;
        if (!mesh.isMesh || !base.isMeshStandardMaterial || base.emissive.getHex() !== 0) return;
        if (!byFinish.has(base)) {
          const finish = lightCabin(base, probes, inverse, index * 20);
          byFinish.set(base, finish);
          finishes.push(finish);
        }
        mesh.material = byFinish.get(base);
      });
    }
    const positions = bake.contours[index];
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const edges = new LineSegments(geometry, ink);
    edges.name = id + " architectural contours";
    edges.scale.setScalar(.001); // The bake stores millimetres in signed 16-bit coordinates.
    room.add(edges);
    lines.push(edges);
  }
  return () => {
    for (const edges of lines) { edges.removeFromParent(); edges.geometry.dispose(); }
    for (const material of finishes) material.dispose();
    probes.dispose();
    ink.dispose();
  };
}
