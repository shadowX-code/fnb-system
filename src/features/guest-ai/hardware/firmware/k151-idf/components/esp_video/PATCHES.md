# Guest AI patches

## DQBUF finite-timeout backport

- Upstream component: `espressif/esp_video` 1.3.1, source commit
  `b914e8cae13055969aaa0d58ffd7e65368588d41`; Component Registry source
  hash `fbad1178f39cb5a81ed808c460c851b911a9858db833e2e667ada988022c0660`.
- Upstream repository: `https://github.com/espressif/esp-video-components`,
  component path `esp_video`.
- Reference: Espressif commit `d7a7aac8ce9b2140c6e5dffe2bfa29bbc73c0205`
  (`feat(esp_video): Add set/get DQBUF timeout value`), first released in
  `esp_video` 2.0.0.
- Changed files: `include/esp_video_ioctl.h`, `private_include/esp_video.h`,
  `src/esp_video.c`, and `src/esp_video_ioctl.c`.
- Difference: 1.3.1 used `portMAX_DELAY` for every `VIDIOC_DQBUF`. This
  backport preserves that default, adds the official set/get ioctls, and lets
  the bridge configure a 2-second finite dequeue wait before capture.
- Scope: no GC0308, DVP, pixel format, registration, buffer lifecycle, or
  sensor dependency changes.
- Removal condition: remove this override after upgrading to an Espressif
  release that includes the official API and is separately qualified for the
  K151 GC0308 `V4L2_PIX_FMT_YUV422P` path.
