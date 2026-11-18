import { MeshBasicMaterial, Vector4 } from "three";

// The authored wall panels select subrectangles of a shared sRGB print atlas.
// Operate in each screen's own 0..1 coordinates without touching those printed UVs.
function uvFrame(screen) {
  const uv = screen.geometry.attributes.uv;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    left = Math.min(left,uv.getX(i)); right = Math.max(right,uv.getX(i));
    top = Math.min(top,uv.getY(i)); bottom = Math.max(bottom,uv.getY(i));
  }
  return new Vector4(left,top,1/(right-left),1/(bottom-top));
}

const signals = {
  command:`
    float bearing = uTime * .62 + .65;
    vec2 track = vec2(.25*cos(bearing), .15*sin(bearing));
    vec2 fix = wall ? vec2(.456,.54) + mat2(.96,-.28,.28,.96)*track : vec2(.28,.62)+track*vec2(.69,.95);
    float distanceToFix = length((q-fix)*vec2(1.65,1.));
    float reticle = 1.-smoothstep(.003,.012,abs(distanceToFix-.042));
    float dotLight = 1.-smoothstep(.004,.018,distanceToFix);
    emission += vec3(.12,.80,1.)*(reticle + dotLight);
    emission += vec3(.006,.030,.115);
  `,
  finance:`
    // The desk tracks a new column after each reading. The wall's revenue bars
    // are printed in the right-hand chart, the desk bars on the left.
    float reading = mod(floor(uTime*.82 + (wall ? 2. : 0.)),12.);
    float x = wall ? .416 + reading*.0459 : .059 + reading*.0371;
    float cursor = 1.-smoothstep(.005,.014,abs(q.x-x));
    float graph = smoothstep(.24,.29,q.y)*(1.-smoothstep(.79,.86,q.y));
    float bar = smoothstep(.08,.34,diffuseColor.g);
    emission += vec3(.055,.48,.47)*cursor*graph*(.18+bar);
    emission += vec3(.006,.022,.037);
  `,
  factory:`
    float joint = mod(floor(uTime*.77),3.);
    vec2 pivot = joint < .5 ? vec2(.137,.829) : joint < 1.5 ? vec2(.188,.582) : vec2(.322,.408);
    float ring = abs(length((q-pivot)*vec2(2.12,1.))-.055);
    float index = 1.-smoothstep(.005,.014,ring);
    float meter = step(.546,q.x)*step(q.x,.66+.18*sin(uTime*.50+.32))*step(.891,q.y)*step(q.y,.920);
    emission += vec3(.50,.62,.20)*index + vec3(.04,.68,.82)*meter;
    emission += vec3(.004,.016,.035);
  `,
  marketing:`
    // Step between storyboard shots at different dwell times.
    float cycle = mod(uTime+1.4,10.7);
    float shot = (cycle>4.2 ? 1. : 0.) + (cycle>7.1 ? 1. : 0.);
    vec2 frame = abs(q-vec2(.185+.307*shot,.551))-vec2(.14,.198);
    float border = 1.-smoothstep(.003,.011,abs(max(frame.x,frame.y)));
    emission += vec3(.62,.30,.74)*border + vec3(.026,.008,.047);
  `,
};

export function instrumentGlass(kind, texture, screen, clock, wall = false) {
  const material = new MeshBasicMaterial({map:texture,toneMapped:false});
  const region = uvFrame(screen);
  material.customProgramCacheKey = () => "station-instrument-" + kind + (wall ? "-wall" : "");
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = clock;
    shader.uniforms.uScreenRegion = {value:region};
    shader.fragmentShader = "uniform float uTime; uniform vec4 uScreenRegion;\n" +
      shader.fragmentShader.replace("#include <color_fragment>", `
        #include <color_fragment>
        vec2 q = (vMapUv - uScreenRegion.xy) * uScreenRegion.zw;
        const bool wall = ${wall ? "true" : "false"};
        vec3 emission = vec3(0.);
        ${signals[kind]}
        diffuseColor.rgb = diffuseColor.rgb * vec3(.95,1.34,1.52) + emission;
      `);
  };
  return material;
}
