import { afterEach, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { stationArt } from "./stationArt.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("releases a decoded GLB when the station closed during parsing", async () => {
  const image = { close: vi.fn() };
  const texture = new Texture(image);
  const material = new MeshStandardMaterial({ emissiveMap: texture, map: texture });
  const mesh = new Mesh(new BoxGeometry(), material);
  const scene = new Group();
  scene.add(mesh);
  const geometryDisposed = vi.spyOn(mesh.geometry, "dispose");
  const textureDisposed = vi.spyOn(texture, "dispose");
  const materialDisposed = vi.spyOn(material, "dispose");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  let finish;
  const decode = vi.spyOn(GLTFLoader.prototype, "parseAsync").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const art = stationArt();
  const mount = vi.fn();
  const loading = art.load("model.glb", mount);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  art.dispose();
  finish({ scene });
  await loading;
  expect(mount).not.toHaveBeenCalled();
  expect(materialDisposed).toHaveBeenCalledOnce();
  expect(geometryDisposed).toHaveBeenCalledOnce();
  expect(textureDisposed).toHaveBeenCalledOnce();
  expect(image.close).toHaveBeenCalledOnce();
});

it("closes the baked lightmap if its decode finishes after leaving the station", async () => {
  const bitmap = { close: vi.fn() };
  let finish;
  const decode = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob() }));
  const art = stationArt();
  const loading = art.loadTexture("factory-occlusion.png");
  await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
  art.dispose();
  finish(bitmap);
  expect(await loading).toBeUndefined();
  expect(bitmap.close).toHaveBeenCalledOnce();
});
