import { Float32BufferAttribute } from "three";

// The upper 128 texel rows cover the floor and the lower 96 cover the rear bulkhead.
// The source GLBs keep their painted UVs. These projections use their cabin-local metres.
export function applyFactoryOcclusion(corner, map) {
  map.channel = 1;
  corner.traverse(mesh => {
    if (!mesh.isMesh) return;
    const material = mesh.material;
    const deck = material.name === "Deck • painted tread and hazard markings";
    if (!deck && material.name !== "Painted cabin liner") return;
    const points = mesh.geometry.attributes.position;
    const uv = new Float32Array(points.count * 2);
    for (let i = 0; i < points.count; i++) {
      uv[i * 2] = (points.getX(i) + 3.7) / 7.4;
      const row = deck ? (points.getZ(i) + 2.45) * 128 / 4.8 : 224 - points.getY(i) * 96 / 3.25;
      uv[i * 2 + 1] = row / 224;
    }
    mesh.geometry.setAttribute("uv1", new Float32BufferAttribute(uv, 2));
    material.aoMap = map;
    material.aoMapIntensity = .96;
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <aomap_fragment>", `
        #include <aomap_fragment>
        // Warm bounce in the occluded areas under the robots and workbench.
        reflectedLight.directDiffuse *= mix(vec3(.72, .50, .38), vec3(1.), ambientOcclusion);
      `);
    };
    material.needsUpdate = true;
  });
}
