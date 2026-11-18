import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Capture ownership before the junction is split among its three station sockets.
function ownModel(root) {
  const meshes = [], geometries = new Set(), materials = new Set();
  const textures = new Set(), bitmaps = new Set(), skeletons = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    meshes.push(node);
    geometries.add(node.geometry);
    for (const material of [].concat(node.material)) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (!value?.isTexture) continue;
        textures.add(value);
        if (value.source.data?.close) bitmaps.add(value.source.data);
      }
    }
    if (node.isSkinnedMesh) skeletons.add(node.skeleton);
    node.castShadow = !node.isSkinnedMesh;
    node.receiveShadow = true;
  });
  return () => {
    for (const mesh of meshes) mesh.removeFromParent();
    for (const skeleton of skeletons) skeleton.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    for (const bitmap of bitmaps) bitmap.close();
  };
}

export function stationArt() {
  const controller = new AbortController();
  const releases = [];
  const loader = new GLTFLoader();
  async function load(url, mount) {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Could not load station art.");
    const bytes = await response.arrayBuffer();
    if (controller.signal.aborted) return;
    // Station GLBs are self-contained. Decoding may finish after a route exit.
    const model = await loader.parseAsync(bytes, "");
    const release = ownModel(model.scene);
    if (controller.signal.aborted) {
      release();
      return;
    }
    releases.push(release);
    mount(model);
  }
  return {
    load,
    dispose() {
      controller.abort();
      for (const release of releases.splice(0)) release();
    },
  };
}
