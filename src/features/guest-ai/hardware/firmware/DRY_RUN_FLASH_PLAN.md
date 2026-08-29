# K151 Guest AI Bridge — first-flash dry run

## Hard gate: not yet approved or executable

The current K151 has only been observed booting from `ota_1`. Its actual partition table, efuse security bits, flash encryption state, secure boot state, and image metadata have **not** yet been read. The `partitions.bridge.csv` file is based on the current official StackChan source layout only; it is not device evidence.

No command in this document should be run until the ROM download-mode read-only audit is complete and the user has explicitly approved flashing.

## Read-only audit required first

1. Use the base USB-C data port and stable power.
2. Hold RST for approximately 2–3 seconds until the internal LED turns green, then release. This enters download mode; it does not erase or flash.
3. Confirm the same Espressif USB JTAG/serial port reappears.
4. Use `esptool.py` only to read chip ID, MAC, `get_security_info`, flash ID, the partition-table sector, and image headers.
5. If security configuration allows and the user approves, create a checksum-verified read-only backup before any write. Do not presume `read_flash` works: encrypted or protected flash may prohibit/alter reads.

## Candidate official-source layout — unverified on device

| Partition | Candidate offset | Candidate size | First flash |
| --- | ---: | ---: | --- |
| bootloader | `0x0000` | device-specific | Never write |
| partition table | `0x8000` | `0x1000` | Never write |
| nvs | `0x9000` | `0x4000` | Never write |
| otadata | `0xd000` | `0x2000` | Read first; do not overwrite casually |
| phy_init | `0xf000` | `0x1000` | Never write |
| ota_0 | `0x20000` | `0x4f0000` | Candidate bridge target only if physical table matches |
| ota_1 | derived | `0x4f0000` | Preserve: currently observed boot slot |
| assets | `0xa00000` | `0x400000` | Never write |
| coredump | derived | `0x10000` | Preserve |

## Read-only command set — do not run until download mode is visible

Use the PlatformIO-installed `esptool.py`, replacing the port only if macOS assigns a new one. These commands never contain a write/erase operation:

```sh
/private/tmp/feedx-pio-env/bin/python ~/.platformio/packages/tool-esptoolpy/esptool.py --chip esp32s3 --port /dev/cu.usbmodem1101 --no-stub chip_id
/private/tmp/feedx-pio-env/bin/python ~/.platformio/packages/tool-esptoolpy/esptool.py --chip esp32s3 --port /dev/cu.usbmodem1101 --no-stub get_security_info
/private/tmp/feedx-pio-env/bin/python ~/.platformio/packages/tool-esptoolpy/esptool.py --chip esp32s3 --port /dev/cu.usbmodem1101 --no-stub flash_id
/private/tmp/feedx-pio-env/bin/python ~/.platformio/packages/tool-esptoolpy/esptool.py --chip esp32s3 --port /dev/cu.usbmodem1101 --no-stub read_flash 0x8000 0x1000 /private/tmp/k151-partitions.bin
```

Only after decoding the physical table may any app-slot image header be read. If the audit reports encrypted/protected flash or secure boot, do not attempt a backup or OTA write until the implications are reviewed.

## Proposed first write — contingent on matching audit

1. Confirm physical partition table exactly matches the table above and that `ota_1` is current.
2. Confirm image size `533456` fits entirely in physical `ota_0`.
3. Write **only** `firmware.bin` at `ota_0` (`0x20000` candidate). Do not write bootloader, partition table, NVS, `otadata`, assets, or coredump.
4. Set the boot target to `ota_0` using the ESP-IDF OTA metadata mechanism only after a verified image write. Exact command is deferred until the physical table and security read prove it is appropriate.
5. Reboot once, capture bridge handshake, and validate only LCD → servo center → one-axis tests. Any failure: return to ROM download mode and use M5Burner official StackChan restore.

## Recovery runbook

- M5Stack documents M5Burner as the official restore method: search `StackChan`, select **Only Official**, download the official package, select the K151 USB port, then Burn. It is a full restore path, not a bridge update path.
- M5Stack states either USB-C port supports data; prefer the base port to avoid accidental movement. For a non-enumerating device, hold RST for 3 seconds until the green LED indicates download mode.
- Treat factory restore as destructive: it may replace both OTA images and may clear NVS-backed Wi-Fi configuration, binding, AI settings, and local history. This must be confirmed from the M5Burner package/UI before invoking it.
- If bridge boot fails, do **not** erase flash. Enter download mode and restore the downloaded official package through M5Burner.
