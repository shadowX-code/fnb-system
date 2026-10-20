# Controlled automatic turn acceptance — 20 October 2026

## Mechanism

The existing adapter remains the sole response owner. `controlled-auto-v1`
negotiates semantic VAD, low eagerness, `create_response:false` and
`interrupt_response:false`. The provider microphone clone stays closed through
output generation/drain; original camera/microphone recording remains live.
I’d like to speak is an intentional interruption, acknowledged before listening.
No additional controller, STT, transport vendor or interview-planning authority.

After semantic EOS, non-overlapping start/stop/commit provenance, finite provider
boundary span >=200 ms, verbal non-hesitation content and actual ASR logprobs
allow automatic acceptance. Mean logprob >=−0.5 and <=20% of tokens below −2 are
conservative heuristics, not calibrated confidence or evidence of identity.
No amplitude threshold and no per-language word-count minimum is used. Provider
boundary span includes padding and is not a precise measured speech duration.

Accepted segments preserve timing/item IDs and create one owned response.
Uncertain hypotheses cannot advance evidence or language context; subsequent
speech discards/quarantines them. Optional Answer controls allow explicit review
and confirmation when detection fails; they are collapsed in normal use.
Duplicate finals are fenced in both conversation and evidence observers, so
late ASR cannot re-quarantine an accepted turn. First-tap recovery, bounded
native activation, generation fencing and immutable recording units are retained.

## Evidence

- Historical `safariTurnRecovery.fixture.json` demonstrates provider automatic
  response creation before ASR finalization and overlapping output interruption.
  Replay cannot cancel output or create a candidate turn in the new input gate.
- Original `physical26Audio.fixture.json` remains the opening/continuity regression.
- Real Staging provider confirmed `include` and actual token logprobs with
  `gpt-4o-transcribe`. Quiet offline-generated EN/BM/Mandarin/Cantonese and a short
  Yes each automatically created exactly one response, without manual submission.
- Generated breath-like noise caused zero accepted turns/responses in the probe.
  This is a synthetic signal, not the original physical microphone recording.
- Fresh generation rebuilt the same synthetic attempt with prior cafe context,
  no repeated welcome, and a real provider cancellation acknowledgement.
  WebSocket output-buffer drain/clear receipts were modeled: WebRTC-only playback
  and hardware audibility remain outside this probe.
- Redacted output: `automaticTurnEvidence.json`; raw synthetic events/audio remain
  in private temporary QA storage. No historical interview/profile/report changed.
- Synthetic attempt `f8518011-bffd-4828-8858-bebb250a9f29` was stopped through the
  authorized lifecycle. Its three no-camera units are honestly Invalid and the
  attempt is Failed; normal finalization may prepare a synthetic report record.
  No media was fabricated and no hiring decision was performed.

## Limits

Token probabilities express ASR uncertainty only. Confident hallucinations,
other audible speakers and incorrect semantic EOS are still possible. A long
thinking pause can end a turn; uncertainty may require the optional fallback.
Automatic acoustic barge-in remains disabled; deliberate interruption is explicit.
The synthetic multilingual samples do not validate local accents or speaker quality.
Physical iPhone Safari Home/Continue, quiet speech, breathing/room noise, actual
playback and recording-gap acceptance remain mandatory before certification.
