// Development-only visual fixture. No provider connection or business mutation.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Room, { InterviewComplete } from "../../src/features/recruitment/RecruitmentInterviewRoom.jsx";
import { InterviewRecoverySurface } from "../../src/features/recruitment/InterviewRecoverySurface.jsx";
import { candidateText } from "../../src/features/recruitment/candidatePreparation.js";
import { initialPresence, observeInterviewPresence } from "../../src/features/recruitment/interviewPresentation.js";
import "../../src/styles/index.css";
import "../../src/features/recruitment/recruitmentPublic.css";

const entry = { job: { position: "Service Crew", workplace: "Happiness Kopitiam Ipoh" } };
const turns = {
  listening: { listening: true },
  thinking: { thinking: true },
  speaking: { speaking: true },
};
const query = new URLSearchParams(location.search);
const fixtureLevel = {
  context: { state: "running" },
  fftSize: 2048,
  getFloatTimeDomainData(samples) { samples.fill(Number(query.get("level")) || 0); },
};

function Fixture() {
  const [mode, setMode] = useState(query.get("state") || "listening");
  const [language, setLanguage] = useState(query.get("lang") === "zh" ? "zh" : "en");
  const t = candidateText(language);
  const turn = turns[mode];
  const presence = observeInterviewPresence(
    turn ? observeInterviewPresence(initialPresence, { type: "candidate.answer.preview", ...turn }) : initialPresence,
    {
      type: "response.output_audio_transcript.done",
      item_id: "fixture",
      transcript: language === "zh"
        ? "如果顾客等餐等了很久，你会怎样处理？"
        : "How would you help a customer whose food has taken longer than expected?",
    },
  );
  return (
    <main className="recruitment-public" lang={language === "zh" ? "zh-Hans" : "en"}>
      <div className="recruitment-public-card">
        <header className="recruitment-public-header">
          <span className="recruitment-mark">FeedX</span>
          <div className="candidate-interface-language"><span>{t.interfaceLanguage}</span><div>
            {["en", "zh"].map(locale => <button key={locale} className="candidate-button is-secondary"
              aria-pressed={language === locale} onClick={() => setLanguage(locale)}>{locale === "en" ? "EN" : "中文"}</button>)}
          </div></div>
        </header>
        {mode === "completed" ? <InterviewComplete entry={entry} language={language} completedAt="2026-11-14T01:50:00Z" />
          : mode === "finalizing" || mode === "interrupted" ? <InterviewRecoverySurface entry={entry} language={language} status={mode} hasConnected>
              {mode === "interrupted" && <button className="candidate-button is-primary" onClick={() => setMode("listening")}>{t.resume}</button>}
            </InterviewRecoverySurface>
          : <Room entry={entry} language={language} presence={presence} recordingStatus="recording" elapsed={222}
              analyser={query.has("level") ? fixtureLevel : undefined}>
              <div className="candidate-live-actions">
                {mode === "speaking" && <button className="candidate-button is-secondary" onClick={() => setMode("listening")}>{t.interrupt}</button>}
                <button className="candidate-button is-end" onClick={() => setMode("finalizing")}>{t.finish}</button>
              </div>
              <button className="candidate-button is-quiet">{t.stop}</button>
            </Room>}
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
