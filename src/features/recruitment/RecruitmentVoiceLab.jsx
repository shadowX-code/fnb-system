import { useEffect, useRef, useState } from "react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import AdminSegmentedControl from "../../components/forms/AdminSegmentedControl.jsx";
import { RecruitmentSection } from "./RecruitmentPresentation.jsx";
import { supabase } from "../../lib/supabase.ts";
import { voices, samples } from "../../../supabase/functions/recruitment-voice-lab/samples.ts";

export const voiceLabAvailable = () => window.location.hostname === "fnb-system-staging.vercel.app" || window.location.hostname === "localhost";
const languages = [{value: "en", label: "English"}, {value: "ms", label: "Bahasa Melayu"}, {value: "zh", label: "Mandarin"}, {value: "yue", label: "Cantonese"}];
export default function RecruitmentVoiceLab({onClose}) {
  const [language, setLanguage] = useState("en"), [busy, setBusy] = useState(""), [error, setError] = useState(""), [ready, setReady] = useState({});
  const cache = useRef(new Map()), audio = useRef(null), operation = useRef(null);
  useEffect(() => () => { operation.current?.abort(); audio.current?.pause(); for (const url of cache.current.values()) URL.revokeObjectURL(url); cache.current.clear(); }, []);
  function changeLanguage(next) { operation.current?.abort(); operation.current = null; audio.current?.pause(); setBusy(""); setError(""); setLanguage(next); }
  async function play(voice) {
    operation.current?.abort(); audio.current?.pause();
    const controller = new AbortController(); operation.current = controller;
    const id = `${voice}:${language}`; setError(""); setBusy(id);
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      let url = cache.current.get(id);
      if (!url) {
        const {data, error: failure} = await supabase.functions.invoke("recruitment-voice-lab", {body: {voice, language}, signal: controller.signal});
        if (failure) { const detail = await failure.context?.json?.().catch(() => null); throw new Error(detail?.error || "Voice sample unavailable. Please retry."); }
        if (!(data instanceof Blob) || data.size < 44) throw new Error("Voice sample incomplete. Please retry.");
        if (operation.current !== controller) return;
        url = URL.createObjectURL(data); cache.current.set(id, url); setReady(current => ({...current, [id]: true}));
      }
      if (operation.current !== controller) return;
      audio.current.src = url;
      await audio.current.play();
    } catch (cause) {
      if (operation.current === controller) setError(cause.name === "NotAllowedError" ? "Sample is ready. Tap Replay to listen." : controller.signal.aborted ? "Sample timed out. Tap Play to retry." : cause.message);
    } finally { clearTimeout(timer); if (operation.current === controller) { operation.current = null; setBusy(""); } }
  }
  return <>
    <button type="button" className="text-sm text-text-secondary justify-self-start" onClick={onClose}>← Recruitment</button>
    <PageHeader section="Staging only" title="Interviewer Voice Lab" description="Compare one interviewer across languages. Voice selection awaits human listening; the live interviewer remains marin." />
    <RecruitmentSection title="Controlled opening sample">
      <div className="p-4 grid gap-4">
        <AdminSegmentedControl ariaLabel="Sample language" value={language} onChange={changeLanguage} options={languages} />
        <p className="text-sm text-text-secondary max-w-prose" lang={language === "zh" || language === "yue" ? "zh" : language}>{samples[language]}</p>
        <p className="text-xs text-text-secondary">Listen for calm Malaysian pacing, warm professional delivery and natural pronunciation. Compare the same sample; no candidate data or microphone is used. Cantonese quality requires human listening.</p>
      </div>
    </RecruitmentSection>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <RecruitmentSection title="Realtime voices" className="is-list">
      {voices.map((voice, index) => { const id = `${voice}:${language}`; return <div key={voice} className="recruitment-profile-row">
        <div><strong>Voice {String.fromCharCode(65 + index)}</strong><p className="text-sm text-text-secondary">{voice}{voice === "marin" ? " · current interviewer" : ""}</p></div>
        <span className="text-sm text-text-secondary" role="status">{busy === id ? "Preparing sample…" : ready[id] ? "Sample ready" : "Not played"}</span>
        <button type="button" className="btn-secondary" disabled={Boolean(busy)} aria-label={`${ready[id] ? "Replay" : "Play"} Voice ${String.fromCharCode(65 + index)} ${voice}`} onClick={() => play(voice)}>{busy === id ? "Preparing…" : ready[id] ? "Replay" : "Play"}</button>
      </div>; })}
    </RecruitmentSection>
    <audio ref={audio} controls aria-label="Voice comparison sample" className="w-full" />
  </>;
}
