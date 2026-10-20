// Semantic EOS finalizes input; the controlled adapter, never automatic provider
// interruption, accepts a candidate turn and owns its one response.
export function interviewTurnDetection(version: string) {
  const automatic = version === "provider-owned-v1";
  return {type:"semantic_vad",eagerness:"low",create_response:automatic,interrupt_response:automatic};
}
