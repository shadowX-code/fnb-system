# K151 recovery readiness — 2026-08-22

## Safety record

- Chip: ESP32-S3 (QFN56), 16 MiB flash.
- Secure Boot: disabled.
- Flash Encryption: disabled.
- Current confirmed running slot before backup: `ota_1`.
- No write, erase, OTA metadata mutation, or bridge flash occurred in this audit.

## Read-only backup manifest

The raw dumps are deliberately stored in `.device-backups/`, which is gitignored. They may contain Wi-Fi credentials, binding data, or other device secrets. The full dump was read directly from the device; the four partition files below are deterministic slices of that verified full dump.

| Artifact | Source range | Expected bytes | SHA-256 |
| --- | --- | ---: | --- |
| `k151-full-20260822.bin` | `0x000000` + `0x1000000` | 16,777,216 | `5cca86096d694ef98d921ada4b9f95563f67a6ec6d13c52a530bcafb716e8684` |
| `k151-ota_0-20260822.bin` | `0x020000` + `0x4F0000` | 5,177,344 | `d0a2319d8982b692dc8d2de8933366bd53c78564dac1f87b15d035823e8debb4` |
| `k151-ota_1-20260822.bin` | `0x510000` + `0x4F0000` | 5,177,344 | `c2bd2ea71256a39c5c19b7e6763c139b8d9313c93af0febd91a6fb2422e3deb5` |
| `k151-otadata-20260822.bin` | `0x00D000` + `0x002000` | 8,192 | `b7e293bb607d3bddb99b7f38a7a45afd5823c0c61e3216e67858bbc759535282` |
| `k151-nvs-20260822.bin` | `0x009000` + `0x004000` | 16,384 | `cefba615246cea933f65199fe0462d664064bcc9be0bf525031f8d8c11215561` |

Direct device read command:

```sh
esptool.py --chip esp32s3 --port /dev/cu.usbmodem1101 --no-stub \
  read_flash 0x000000 0x1000000 k151-full-20260822.bin
```

The four partition artifacts were made from that full dump with byte-accurate `dd` slices at the ranges above; their sizes and hashes were checked locally.

```sh
dd if=k151-full-20260822.bin of=k151-ota_0-20260822.bin bs=1 skip=131072 count=5177344 status=none
dd if=k151-full-20260822.bin of=k151-ota_1-20260822.bin bs=1 skip=5308416 count=5177344 status=none
dd if=k151-full-20260822.bin of=k151-otadata-20260822.bin bs=1 skip=53248 count=8192 status=none
dd if=k151-full-20260822.bin of=k151-nvs-20260822.bin bs=1 skip=36864 count=16384 status=none
```

## OTA status and fallback

`otadata` contains two valid selection records:

- sector 0: sequence `1`, state `VALID` (`2`) — selects `ota_0`.
- sector 1: sequence `2`, state `VALID` (`2`) — highest sequence, selects `ota_1`.

Both images pass ESP32-S3 image checksum and validation-hash verification:

| Slot | Factory image |
| --- | --- |
| `ota_0` | `stack-chan` v1.2.4; ESP-IDF v5.5.4; built 2026-04-15 09:18:33 |
| `ota_1` | `stack-chan` v1.5.1; ESP-IDF v5.5.4; built 2026-07-31 10:38:34 |

The first bridge test must preserve `ota_1`. If a bridge in `ota_0` fails, enter download mode and restore the saved `otadata` backup to `0xD000`; this reselects the current valid `ota_1` record without changing any application image. If `otadata` is unavailable or corrupt, restore the saved `ota_1` image at `0x510000` and then restore its saved `otadata` at `0xD000`. Neither operation should be improvised: perform only after explicit flash approval.

## Verified official recovery package

M5Burner v3.0.0 for macOS was downloaded from the official M5Stack CDN and its package was inspected, not run against the device. Its StackChan catalog entry is official `StackChan-UserDemo` v1.5.1, dated 2026-07-31, file `746f9662f48ac465cccf49bcad941414.bin`.

The downloaded package SHA-256 is `411578a2ebca2cfe3541fdc32aeddbc4703cf912a5daa7e1253f69306d6e1d87`. It is a merged image written by M5Burner at `0x000`; it contains bootloader, partition table, blank NVS/otadata/phy-init regions, a v1.5.1 application in `ota_0`, and assets through `0xC310AD`. It does not extend to `ota_1` (`0x510000`) or coredump.

Consequences: restoring this package overwrites bootloader, partition table, `ota_0`, NVS, `otadata`, and part of assets. It therefore clears device-local Wi-Fi/binding/settings held in NVS. It does not overwrite the existing `ota_1` image. Do not click M5Burner's separate **Erase** action; that is a full-chip erase and is not part of the recovery plan.

## Factory recovery runbook

1. Put K151 into download mode and connect its data-capable USB-C port.
2. Open M5Burner, search **StackChan**, enable **Only Official**, select **StackChan-UserDemo v1.5.1**, and download it.
3. Select `/dev/cu.usbmodem1101` (or the current K151 serial port) and the StackChan device type.
4. Do **not** use **Erase**. Use **Burn/Flash** only.
5. Wait for the tool's successful completion, reset the K151, and complete factory setup again because NVS is reset.

This is a destructive recovery operation, not part of this audit.
