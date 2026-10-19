// Automatic VAD may finalize input, but cannot accept a controlled candidate turn.
export function interviewTurnDetection(version: string) {
  const automatic = version === "provider-owned-v1";
  return {type:"semantic_vad",eagerness:"low",create_response:automatic,interrupt_response:automatic};
}
