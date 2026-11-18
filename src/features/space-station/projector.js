import * as T from "three";
import { group } from "./modelKit.js";

const continents = [
    [[-168,66],[-147,71],[-130,60],[-108,70],[-84,72],[-56,53],[-74,45],[-81,30],[-97,21],[-88,16],[-83,9],[-103,18],[-118,32],[-128,51],[-143,59]],
    [[-81,11],[-66,12],[-50,1],[-35,-6],[-43,-23],[-55,-38],[-68,-55],[-75,-48],[-72,-29],[-81,-7]],
    [[-54,83],[-22,80],[-31,68],[-45,60],[-58,68]],
    [[-17,15],[-10,31],[5,37],[21,33],[32,31],[42,13],[51,11],[43,-3],[35,-12],[31,-30],[18,-35],[11,-18],[9,-4],[-2,5],[-16,7]],
    [[-10,36],[-10,44],[2,48],[6,57],[18,60],[28,70],[51,69],[70,73],[98,76],[123,72],[150,70],[178,66],[164,56],[147,51],[139,36],[126,38],[122,26],[109,19],[105,9],[97,18],[80,7],[73,20],[59,25],[55,17],[42,14],[35,29],[23,38],[11,45],[4,41]],
    [[112,-22],[119,-18],[131,-12],[137,-17],[145,-12],[154,-26],[147,-38],[132,-33],[116,-35]],
    [[47,-14],[51,-15],[47,-25],[44,-24]],[[130,32],[142,45],[144,43],[137,32]],
    [[-180,-73],[-140,-70],[-95,-75],[-61,-64],[-57,-73],[-5,-70],[48,-66],[99,-66],[152,-70],[180,-74],[180,-90],[-180,-90]],
];

function globeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const ink = canvas.getContext("2d");
  const xy = ([lon, lat]) => [(lon + 180) * canvas.width / 360, (90 - lat) * canvas.height / 180];
  const ocean = ink.createLinearGradient(0, 0, 0, canvas.height);
  ocean.addColorStop(0, "#103fa2");
  ocean.addColorStop(.53, "#072d78");
  ocean.addColorStop(1, "#065eac");
  ink.fillStyle = ocean;
  ink.fillRect(0, 0, canvas.width, canvas.height);
  ink.lineJoin = "round";
  for (const coast of continents) {
    ink.beginPath();
    coast.forEach((coords, i) => {
      const [x,y] = xy(coords);
      if (i) ink.lineTo(x,y);
      else ink.moveTo(x,y);
    });
    ink.closePath();
    ink.fillStyle = "#2caaef";
    ink.fill();
    ink.strokeStyle = "#bcf8ff";
    ink.lineWidth = 2.5;
    ink.stroke();
  }

  ink.strokeStyle = "#42baf0";
  ink.lineWidth = 1.4;
  for (let x = 0; x < canvas.width; x += canvas.width / 16) {
    ink.beginPath(); ink.moveTo(x,0); ink.lineTo(x,canvas.height); ink.stroke();
  }
  for (let y = 0; y < canvas.height; y += canvas.height / 8) {
    ink.beginPath(); ink.moveTo(0,y); ink.lineTo(canvas.width,y); ink.stroke();
  }
  // Navigation fixes and their geodesic links are baked on the sphere, on both hemispheres.
  const stations = [[-123,49], [-74,41], [-44,-23], [-.1,51], [31,30], [78,13], [104,1], [139,36], [151,-34]];
  for (const [from,to] of [[0,1],[1,3],[1,2],[3,4],[4,5],[5,6],[6,7],[6,8]]) {
    const [ax,ay] = xy(stations[from]), [bx,by] = xy(stations[to]);
    ink.beginPath(); ink.moveTo(ax,ay);
    ink.quadraticCurveTo((ax+bx)/2, Math.min(ay,by)-Math.abs(bx-ax)*.21, bx,by);
    ink.strokeStyle = "rgba(160,245,255,.78)"; ink.lineWidth = 1.7; ink.stroke();
  }
  for (const station of stations) {
    const [x,y] = xy(station);
    ink.strokeStyle = "#9deeff"; ink.lineWidth = 1.6;
    ink.beginPath(); ink.arc(x,y,5.8,0,Math.PI*2); ink.stroke();
    ink.fillStyle = "#fff9db";
    ink.beginPath(); ink.arc(x,y,2.8,0,Math.PI*2); ink.fill();
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function opticalHalo() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const glow = ctx.createRadialGradient(64,64,0,64,64,64);
  glow.addColorStop(0,"rgba(15,114,255,0)");
  glow.addColorStop(.65,"rgba(15,114,255,.03)");
  glow.addColorStop(.70,"rgba(8,132,255,.87)");
  glow.addColorStop(.74,"rgba(38,184,255,.69)");
  glow.addColorStop(.82,"rgba(19,123,255,.26)");
  glow.addColorStop(1,"rgba(6,90,255,0)");
  ctx.fillStyle=glow;
  ctx.fillRect(0,0,128,128);
  const texture=new T.CanvasTexture(canvas);
  texture.colorSpace=T.SRGBColorSpace;
  const halo=new T.Sprite(new T.SpriteMaterial({map:texture,blending:T.AdditiveBlending,depthWrite:false,toneMapped:false}));
  halo.scale.set(2.90,2.90,1);
  return halo;
}

// One optical face overlays the existing glass disc at y=.73 m. Its rotating
// indexing arcs and hot core are projected light and follow the simulated clock.
function emitter(clock) {
  const material = new T.ShaderMaterial({
    uniforms:{ uTime:clock }, transparent:true, depthWrite:false, blending:T.AdditiveBlending,
    vertexShader:`varying vec2 aperture;
      void main() {
        aperture = uv * 2.0 - 1.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader:`uniform float uTime; varying vec2 aperture;
      void main() {
        float radius = length(aperture);
        if (radius > 1.) discard;
        float angle = atan(aperture.y, aperture.x);
        float rim = 1. - smoothstep(.009, .034, abs(radius-.93));
        float middle = (1.-smoothstep(.015,.042,abs(radius-.72))) * smoothstep(-.82,-.35,cos(angle*3.-uTime*.59));
        float iris = (1.-smoothstep(.010,.035,abs(radius-.45))) * (.7+.3*cos(angle*5.+uTime*.41));
        float core = 1.-smoothstep(.07,.52,radius);
        vec3 light = vec3(.008,.15,.32)*(1.-radius) + vec3(.04,.73,1.)*(rim+middle+iris) + vec3(.12,.89,1.)*core;
        gl_FragColor = vec4(light, 1.-smoothstep(.95,1.,radius));
        #include <colorspace_fragment>
      }`,
  });
  const disc = new T.Mesh(new T.PlaneGeometry(1.58,1.58), material);
  disc.name = "Projector aperture";
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = .745;
  return disc;
}

export function orbitalProjector(cabin) {
  const base = group(cabin,.15,0,.03);
  const holo = group(base,0,1.85,0);
  const clock = { value:0 };
  base.add(emitter(clock));
  const globe = new T.MeshBasicMaterial({ map:globeTexture(), toneMapped:false });
  globe.onBeforeCompile = shader => {
    shader.uniforms.uTime = clock;
    shader.vertexShader = "varying vec2 vGlobe;\n" + shader.vertexShader.replace("#include <project_vertex>", `
      #include <project_vertex>
      vGlobe = vec2(abs(normalize(normalMatrix * normal).z), normal.y);
    `);
    shader.fragmentShader = "varying vec2 vGlobe; uniform float uTime;\n" + shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float rim = pow(1.-vGlobe.x, 2.7);
      float band = abs(vGlobe.y - .75*sin(uTime*.61-.89));
      diffuseColor.rgb += vec3(.014,.25,.66)*rim;
      diffuseColor.rgb += vec3(.34,.92,1.) * smoothstep(.50,.96,rim);
      diffuseColor.rgb += vec3(.015,.24,.42)*(1.-smoothstep(.012,.047,band));
    `);
  };
  const world = new T.Mesh(new T.SphereGeometry(1.02,48,32),globe);
  world.name = "Navigation globe";
  holo.add(world,opticalHalo());
  const track = new T.Mesh(new T.TorusGeometry(1.092,.009,6,96),
    new T.MeshBasicMaterial({color:"#adfbff",toneMapped:false}));
  track.rotation.order="YXZ";
  track.rotation.set(1.27,0,-.27);
  holo.add(track);
  return time => {
    clock.value = time;
    world.rotation.y = time*.105 - 2.75;
    track.rotation.y = .56 + time*.084;
    holo.position.y = 1.85 + .015*Math.sin(time*1.17);
  };
}
