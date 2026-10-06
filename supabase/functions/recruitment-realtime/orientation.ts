// A presentation checkpoint, not coverage/completion/hiring authority. Receipts
// are browser-relayed observations and never proof of candidate comprehension.
export const orientationStart = "[FEEDX ORIENTATION]";
export const orientationEnd = "[/FEEDX ORIENTATION]";
export function meaningfulSpeech(text: string) {
  const words = text.toLowerCase().replace(/[\p{P}\p{S}]/gu, " ").trim().replace(/\s+/g, " ");
  return !!words && !/^(?:(?:hello|hi|hey|there|ok|okay|yes|yeah|yep|hmm|hm|um|uh|lah|嗯|好|好的|哦|啊|是|对|喂)\s*)+$/u.test(words);
}
export function orientationPresented(turns: any[], annotations: any[], traces: any[]) {
  return traces.some(trace => {
    const r = trace.record;
    if (r?.type !== "output_audio_buffer.stopped" || r.phase !== "orientation_complete") return false;
    const ai = turns.find(t => t.speaker === "ai" && t.provider_generation === trace.provider_generation && t.provider_item_id === r.item_id);
    return !!ai && !annotations.some(a => a.kind === "truncated" && a.provider_generation === ai.provider_generation && a.provider_item_id === ai.provider_item_id);
  });
}

export function orientationComplete(turns: any[], annotations: any[], traces: any[]) {
  return traces.some(trace => orientationPresented(turns, annotations, [trace]) && turns.some(t => {
    const ai = turns.find(a => a.provider_generation === trace.provider_generation && a.provider_item_id === trace.record.item_id && a.speaker === "ai");
    return t.speaker === "candidate" && t.turn_number > ai.turn_number && meaningfulSpeech(t.transcript);
  }));
}
