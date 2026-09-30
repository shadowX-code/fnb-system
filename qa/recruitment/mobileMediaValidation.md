# Phase 2 real-device media validation

Open `https://fnb-system-staging.vercel.app/qa/recruitment-media-probe.html` in current iOS Safari and Android Chrome on physical phones. The probe records locally and uploads nothing. Use synthetic speech and clear the saved samples after testing.

For each device:

1. Allow the camera and microphone for this session. Confirm the preview is live.
2. Record two five-second segments. Confirm both have nonzero bytes, independently load metadata, and play audio and video.
3. Reload. Confirm both saved segments still play. Copy the diagnostic report and record the device model, OS/browser versions, and whether sound and picture actually play.
4. Clear samples. Repeat while locking the screen or switching apps during the second segment. Record whether capture stops, pauses, resumes, or loses data. Do not infer continuity from the probe's completion message alone.
5. Clear samples and revoke camera/microphone access if desired.

The probe establishes codec/container, segment playability, browser storage recovery, and interruption behavior. It does **not** establish upload retry, server verification, or long-duration thermal/storage behavior. Those need an end-to-end Staging interview after implementation. Do not lock the recording MIME, segment interval, upload workflow, or completeness criteria solely from desktop browser results.
