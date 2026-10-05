// Development-only visual fixtures. No token, provider, media or business mutation.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Room, {
  InterviewComplete,
} from "../../src/features/recruitment/RecruitmentInterviewRoom.jsx";
import {
  initialPresence,
  observeInterviewPresence,
} from "../../src/features/recruitment/interviewPresentation.js";
import "../../src/styles/index.css";
import "../../src/features/recruitment/recruitmentPublic.css";
const entry = {
  job: {
    position: "Service Crew / 服务员",
    title: "Service Crew",
    workplace: "Happiness Kopitiam Ipoh · 客服与餐饮团队",
  },
};
const signals = {
  Listening: { type: "input_audio_buffer.speech_started" },
  Thinking: { type: "response.created" },
  Speaking: { type: "output_audio_buffer.started" },
};
function Fixture() {
  const [mode, setMode] = useState("Listening"),
    [text, setText] = useState("EN");
  let presence = observeInterviewPresence(initialPresence, signals[mode] || {});
  presence = observeInterviewPresence(presence, {
    type: "response.output_audio_transcript.done",
    item_id: "fixture",
    transcript:
      text === "中文"
        ? "如果顾客等餐等了很久，你会怎样处理？"
        : text === "粤语"
          ? "如果客人等咗好耐都未有餐，你會點處理？"
          : text === "BM"
            ? "Bagaimana anda membantu pelanggan yang menunggu makanan terlalu lama?"
            : "How would you help a customer whose food has taken longer than expected?",
  });
  return (
    <>
      <div
        style={{
          padding: 12,
          background: "#fff",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <strong style={{ width: "100%" }}>
          Visual fixture · no live interview
        </strong>
        {["Listening", "Thinking", "Speaking", "Recovering", "Complete"].map(
          (value) => (
            <button
              key={value}
              className="btn-secondary"
              onClick={() => setMode(value)}
            >
              {value}
            </button>
          ),
        )}
        {["EN", "BM", "中文", "粤语"].map((value) => (
          <button
            key={value}
            className="btn-secondary"
            onClick={() => setText(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <main className="recruitment-public">
        <div className="recruitment-public-card">
          <header className="recruitment-public-header">
            <span className="recruitment-mark">FeedX</span>
            <span>Interview</span>
          </header>
          {mode === "Complete" ? (
            <InterviewComplete
              entry={entry}
              completedAt="2026-10-05T12:50:00Z"
            />
          ) : (
            <Room
              entry={entry}
              presence={presence}
              status={mode === "Recovering" ? "interrupted" : "interviewing"}
              recordingStatus="recording"
              elapsed={222}
            >
              <button className="btn-primary">
                {mode === "Recovering"
                  ? "Continue interview"
                  : "Finish interview"}
              </button>
            </Room>
          )}
        </div>
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(<Fixture />);
