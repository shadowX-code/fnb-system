# K151 Guest AI Camera Format Negotiation Fix Build Artifact

- Clean ESP-IDF build: 2026-08-22
- ESP-IDF: 5.5.4
- Firmware version: `cd42e2c-dirty`
- Binary: `build/feedx_k151_guest_ai_bridge.bin`
- Exact binary size: 440,480 bytes
- SHA-256: `ce88a7a9b009d60d09152c4416a6846fd26bbfb65c3a045dad4d3b2c6ac65cf7`
- `ota_0` capacity: 5,177,344 bytes (`0x4f0000`)
- `ota_0` remaining: 4,736,864 bytes
- Image validation: ESP-IDF esptool checksum and validation hash valid
- Dependency lock: present and unchanged by the clean build; SHA-256 `66fd50041c075a0d210a967dbc116cf17abe405e694e57a79d0ef2773b4b93df`

This candidate retains the GC0308 node-registration and USB runtime scheduling
fixes. The sole camera change makes the production V4L2 lifecycle negotiate
format before buffer allocation: `QUERYCAP → G_FMT → ENUM_FMT → S_FMT →
REQBUFS`. It was not flashed, and no `otadata` or partition state was modified.
