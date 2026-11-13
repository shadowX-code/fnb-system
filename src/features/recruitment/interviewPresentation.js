// Presentation observes accepted provider events; it never creates/cancels a turn.
export const interviewLanguages = [
  { value: "en", label: "English" },
  { value: "ms", label: "Bahasa Melayu" },
  { value: "zh", label: "中文" },
  { value: "yue", label: "粤语" },
];
export const languageLabel = (value) =>
  interviewLanguages.find((x) => x.value === value)?.label || "English";
export const initialPresence = { state: "connecting", prompt: "", item: null };
export function observeInterviewPresence(current, event) {
  const type = event.type;
  if (type === "candidate.answer.preview") {
    const state = event.speaking ? "speaking" :
      event.thinking ? "thinking" : event.listening ? "listening" :
      current.state === "connecting" ? "connecting" : "thinking";
    return { ...current, state };
  }
  if (type === "candidate.answer.accepted" || type === "response.created")
    return { ...current, state: "thinking" };
  if (
    [
      "response.output_audio_transcript.delta",
      "response.audio_transcript.delta",
    ].includes(type)
  )
    return {
      ...current,
      item: event.item_id,
      prompt:
        current.item === event.item_id
          ? current.prompt + (event.delta || "")
          : event.delta || "",
    };
  if (
    [
      "response.output_audio_transcript.done",
      "response.audio_transcript.done",
    ].includes(type)
  )
    return {
      ...current,
      item: event.item_id,
      prompt: event.transcript || current.prompt,
    };
  return current;
}
