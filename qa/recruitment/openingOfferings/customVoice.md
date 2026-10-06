# Authorized Malaysian custom voice feasibility (research only, 2026-10-06)

Official OpenAI [custom voices](https://developers.openai.com/api/docs/guides/custom-voices) support Realtime voice IDs. Access is restricted to eligible organizations; FeedX eligibility is unconfirmed. The current Staging implementation uses gpt-realtime-1.5 and marin. No custom voice was created or configured, no provider/model changed, and no account entitlement can be inferred from working built-in voices.

An authorized speaker must provide two separate recordings: exact OpenAI consent phrase and matching voice reference sample (30 seconds maximum, supported audio format). Use a clear 10–30 second studio-quality sample with the intended natural Malaysian interview delivery. Creation needs account access and the consent ID; returned voice ID is selected when starting a session. This fits FeedX's existing fresh-generation boundary conceptually. Model/project-specific permission and compatibility still need confirmation before integration.

Multilingual quality is unverified: a Malaysian English reference does not establish BM, Mandarin or Cantonese pronunciation. Human listening of controlled samples across all four languages is required; one identity is preferred only if it works across them. No claim of accent fidelity or lower latency is justified yet.

The [deployed model's pricing](https://developers.openai.com/api/docs/models/gpt-realtime-1.5) remains the baseline for current audio/text usage. Public custom-voice documentation does not establish a FeedX-specific fee or latency guarantee. Obtain the organization's eligibility, commercial terms and model compatibility from OpenAI; benchmark only after authorized setup. Stored Voice Lab replay has Storage/Edge cost but no new provider generation.

Exact next input: confirm eligible OpenAI organization/project, nominate an explicitly consenting Malaysian voice actor, and provide their exact consent recording plus a clean matching reference. Authorize creation and controlled multilingual listening separately. No voice cloning action is included in this task.
