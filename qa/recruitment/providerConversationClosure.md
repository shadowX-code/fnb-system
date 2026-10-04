# Provider-owned Recruitment conversation closure

## Boundary

The ordinary manual InterviewResponseOwner/playback-clearance scheduler is removed. The Recruitment OpenAI adapter uses semantic VAD (low eagerness), provider automatic responses and provider interruptions. Explicit entry is once per generation; tool continuation is once per tool result after its response completes. Playback receipts remain evidence observations, never permission to answer a candidate.

The transport-generation controller owns the disposable interviewer, fences late callbacks and independently refreshes canonical server context. The transcript observer preserves order and truncation evidence without blocking speech. Recording, consent, Recruitment authority and hiring are unchanged. Older clients retain their prior session flags during compatible Edge/UI delivery.

## Focused verification

65 tests across six files pass: saved physical interruption sequence, entry/live speech race, exactly-once ordinary response observation, pause/short-answer protocol cases, next-response timeout to recovery, interruption without old playback receipts, tools, late/stale generations, quiet context, independent persistence, truncation receipts, fresh reconstruction and recording recovery. The generation tests also prevent indefinite sliding coverage cache and late assessment interference. Six preparation/launch tests and the production build passed.

A synthetic real-provider browser run against Staging passed EN/BM/Chinese input, a short barge-in, automatic response/interrupt session flags, no ordinary client response.create, quiet server context updates, foreground reconstruction, cold refresh reconstruction and saving truthful Partial evidence. An initial synthetic audio-source run did not reach EOS; the harness now supplies a continuous silent native input between utterances and the repeat passed. No runtime delay or production workaround was added for that harness condition.

These checks establish protocol behavior and real provider integration, not physical iPhone recovery, accent quality or noisy-environment certification. Physical acceptance remains required before Production. Canonical delivery/runtime results are reported in the task handoff.
