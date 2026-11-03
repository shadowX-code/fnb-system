// Modified 2026-11-03 for an GPL-3.0 FeedX Staging browser program: reviewed HUD allowlist and isolated bridge; no upstream visual renderer changes.
// Loads three.js as a module, hands it to the HUD scripts on window, then runs them in order.
// The HUD scripts are classic scripts on purpose: they share one global scope, so each file can use what the
// files before it declared (the scene, the core, the skins...) without a bundler. Order matters.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
Object.assign(window, { THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass });
const PARTS = ["core.js", "nav.js", "render.js", "skins.js", "cores/kit.js", "cores/neural.js", "cores/nebula.js", "cores/ion.js", "cores/works.js", "cores/factory.js", "cores/spider.js", "cores/ops.js", "skin-picker.js", "demo-mode.js", "loop.js", "panels.js", "interaction.js", "subtitles.js", "creator.js"];
for (const p of ['../disabled-features.js', ...PARTS, '../web.js']) {
 const s=document.createElement('script'); s.src=new URL(p, new URL('./js/',document.baseURI)); s.async=false;
 await new Promise((resolve,reject)=>{s.onload=resolve;s.onerror=reject;document.body.appendChild(s);});
}
