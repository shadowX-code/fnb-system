# FeedX Guest AI K151 bridge

This is a standalone PlatformIO/Arduino firmware project. It adapts the canonical FeedX Device Protocol v1 to the K151; it contains no FeedX business data, network backend, LLM, camera stream, STT, or TTS. `play_audio` is restricted to the built-in `test_tone`, preserving compatibility with the existing console without introducing audio playback or TTS.

## Pinned sources

- StackChan-BSP `f7ed40e6f5d9a1d08440cb926f3a0865b81882f8` (official)
- PlatformIO `espressif32@6.12.0`
- ArduinoJson `^7.4.2`

`partitions.bridge.csv` mirrors the current official source layout only. It is **not** proof of the physical K151 layout and must never be flashed until `esptool` has read the device partition table and the first-flash plan has been approved.

Build once the local temporary PlatformIO environment is available:

```sh
/private/tmp/feedx-pio-env/bin/pio run -d src/features/guest-ai/hardware/firmware -e k151_bridge
/private/tmp/feedx-pio-env/bin/pio test -d src/features/guest-ai/hardware/firmware -e native
```

The first bridge deliberately reports camera as `blocked`: official StackChan factory firmware uses ESP-IDF's `esp_video` DVP driver, which is not part of the lightweight Arduino BSP. This is a truthful blocker, not a pass result.
