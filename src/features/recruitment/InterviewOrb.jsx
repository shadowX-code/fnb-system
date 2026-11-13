import { useEffect, useId, useRef } from "react";

const latitudes = [-72, -56, -40, -24, -8, 8, 24, 40, 56, 72];

export default function InterviewOrb({ state, analyser }) {
  const id = useId();
  const orb = useRef(null);

  useEffect(() => {
    if (state !== "speaking" || !analyser?.getFloatTimeDomainData) return;
    const node = orb.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const samples = new Float32Array(analyser.fftSize);
    let timer;
    let level = 0;
    const stop = () => {
      clearInterval(timer);
      level = 0;
      node.style.removeProperty("--orb-energy");
    };
    const sync = () => {
      stop();
      if (reducedMotion.matches || document.hidden) return;
      timer = setInterval(() => {
        if (analyser.context.state !== "running") {
          node.style.removeProperty("--orb-energy");
          level = 0;
          return;
        }
        // Read the existing playback analyser without attaching another audio source.
        analyser.getFloatTimeDomainData(samples);
        let squared = 0;
        for (const sample of samples) squared += sample * sample;
        const measured = Math.min(1, Math.sqrt(squared / samples.length) * 7);
        level += (measured - level) * 0.55;
        node.style.setProperty("--orb-energy", level.toFixed(3));
      }, 50);
    };
    sync();
    reducedMotion.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop();
      reducedMotion.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [state, analyser]);

  return (
    <svg className="candidate-orb" ref={orb} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={`${id}-atmosphere`}>
          <stop stopColor="var(--orb-color)" stopOpacity=".19" />
          <stop offset=".68" stopColor="var(--orb-color)" stopOpacity=".11" />
          <stop offset="1" stopColor="var(--orb-color)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x2="1" y2="1">
          <stop stopColor="var(--orb-color)" />
          <stop offset=".58" stopColor="var(--orb-color)" stopOpacity=".22" />
          <stop offset="1" stopColor="var(--orb-color)" stopOpacity=".82" />
        </linearGradient>
      </defs>
      <circle cx="128" cy="128" r="126" fill={`url(#${id}-atmosphere)`} />
      <circle cx="128" cy="128" r="108" fill="none" stroke="currentColor" strokeOpacity=".15" />
      <g fill="none" transform="rotate(-25 128 128)">
        <g className="candidate-orb-grid" stroke="currentColor" strokeWidth=".8">
          <circle cx="128" cy="128" r="87" strokeOpacity=".62" />
          {[23, 46, 68].map(radius => <ellipse key={radius} cx="128" cy="128" rx={radius} ry="87" strokeOpacity=".31" />)}
          {latitudes.map(offset => (
            <ellipse key={offset} cx="128" cy={128 + offset} rx={Math.sqrt(87 ** 2 - offset ** 2)}
              ry={Math.sqrt(87 ** 2 - offset ** 2) * .2} strokeOpacity=".32" />
          ))}
        </g>
        <circle cx="128" cy="128" r="87" stroke={`url(#${id}-rim)`} strokeWidth="1.25" />
      </g>
      <g className="candidate-orb-signal" fill="none" strokeLinecap="round">
        <path d="M36 128C58 128 65 112 82 113S110 148 129 148s26-39 45-39 26 19 46 19" stroke="currentColor" strokeOpacity=".36" strokeWidth="1" />
        <path d="M36 128c24 0 33-6 49-6 17 0 25 14 43 14 19 0 26-19 43-19s27 11 49 11" stroke={`url(#${id}-rim)`} strokeWidth="1.8" />
      </g>
      <g className="candidate-orb-orbit" fill="none" stroke="currentColor">
        <circle cx="128" cy="128" r="108" strokeDasharray="25 654" strokeLinecap="round" />
        <circle cx="236" cy="128" r="2.5" fill="currentColor" />
      </g>
    </svg>
  );
}
