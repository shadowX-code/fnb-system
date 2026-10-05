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
  if (
    type === "input_audio_buffer.speech_started" ||
    type === "output_audio_buffer.cleared"
  )
    return { ...current, state: "listening" };
  if (
    [
      "input_audio_buffer.speech_stopped",
      "input_audio_buffer.committed",
      "response.created",
    ].includes(type)
  )
    return { ...current, state: "thinking" };
  if (type === "output_audio_buffer.started")
    return { ...current, state: "speaking" };
  if (type === "output_audio_buffer.stopped")
    return { ...current, state: "listening" };
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
