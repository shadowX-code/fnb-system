# V1 disposable browser transport / durable interview

## Physical evidence and removed path

Latest physical attempt `78cdd586-ff33-4b60-b9c0-1b12180ee282` on application `1449cc6d-9537-4cb1-96e5-b6093c5ec5e0` retained recording/interview evidence through interruptions. Its provider-connected timeline includes generation 4 at 12:59:42 UTC without a new recording unit, then provider_reconnect_failed at 12:59:43. Generation 6 at 13:01:53 also had no replacement recording unit. Those were reachable provider-only retries, independent from the full reconstruction owner. Original physical evidence is retained unchanged.

## Final V1 contract

The interview attempt remains durable. Browser camera/mic, recorder and realtime transport ownership are disposable. Background, cold refresh, dead peer/channel, audio playback activation failure or any setup error exposes one Continue interview action. No Reconnect AI, provider-only timer or separate Enable interviewer audio control remains. Realtime instances are single-use; only full reconstruction can invoke connection.

Continue requests fresh native camera/mic first from the user gesture, activates fresh Web Audio in that same gesture, validates live tracks, obtains an idempotent server recovery identity, opens a fresh recording unit and creates a fresh realtime provider generation. Existing canonical context hydrates opening instructions, facts, finalized recent turns, coverage/scenario state, unresolved evidence and remaining active time, with explicit instructions against repeating completed speech/questions. No authority, voice profile, report or hiring rules change.

The active UX is published only after recording and realtime setup both succeed. Failure stops capture and transport and returns to Continue with a useful reason. Old provider/media callbacks are fenced; pending old cleanup/uploads cannot gate reconstruction. Repeated Continue replaces client work while retaining a single tab claim; server CAS and request/result caching preserve ownership. Final gaps/uncertain recording units remain explicit/Partial. Cold bootstrap does not create old browser transport objects.

## Focused verification

44 consumer/native tests across six files pass, including dead transport/audio failure to Continue, pending-provider replacement, stale callbacks/tracks, native hang/denial/error, foreground/cold reconstruction and pending uploads. Production build and diff check pass. Canonical provider and existing Staging authority contracts are verified after delivery. Fault injections are not physical iOS certification; Production remains blocked. One fresh physical invitation is prepared only after technical checks pass.
