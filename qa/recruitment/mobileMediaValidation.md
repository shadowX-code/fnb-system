# Phase 2 physical-device evidence and remaining checks

## Supplied physical evidence

| Device / browser | First ~5 s stopped MP4 unit | Second ~5 s stopped MP4 unit |
|---|---|---|
| iPhone Safari 18.7.5 / iOS 18.7 | 480×640 video | Metadata loads, 0×0 video; failure reproduced twice |
| iPhone Chrome 154 / iOS | 480×640 video | 480×640 video |
| Android Chrome 154 | 480×640 video | 480×640 video |

MediaRecorder and MP4 H.264/AAC were supported. These are short local probe results supplied by the user, not full interview/upload certification. Continuous-recorder timeslice bytes are never independent playback files.

## Implemented strategy

One foreground MediaRecorder per recording unit, stopped and finalized as one complete MP4 container. Five-second blobs are locally queued/uploaded transport bytes. Playback requires the assembled unit, nonzero browser video metadata and server MP4 structural verification. AI reconnect leaves the recording running. Background/device/reload interruptions create gaps, then fresh device capture and a new unit in the same attempt. Uncertain units remain partial or failed; acknowledged bytes remain private evidence.

Safari's second-unit failure means a resumed Safari recording can still fail verification. The first acknowledged valid unit is retained. Full codec decode is verified through playback, not inferred from server box parsing. Background continuity and trailer finalization cannot be guaranteed by the browser.

## Physical end-to-end checks still needed

Use synthetic candidates and speech on canonical Staging. Run the complete candidate preparation and interview, including mixed candidate/interviewer audio, EN/BM/Chinese/code-switching, dynamic follow-up and scenario coverage. Play the final file from the authorized manager view.

Test a configured full-duration interview and a second capture after backgrounding/screen lock. Confirm explicit gap/partial status, fresh permissions where required, retained first recording, no false completeness on 0×0 video, reconnect without recording restart, upload offline/retry, and reload recovery. Check practical storage, memory, battery/thermal and echo behavior. These have not been established by the short physical probe and must not be claimed as validated mobile compatibility.
