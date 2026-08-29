# On-device reliability test firmware

`sdkconfig.fault-test.defaults` enables `CONFIG_FEEDX_GUEST_AI_FAULT_INJECTION=y`.
This firmware is only for K151 reliability validation and must be replaced with
the normal (`n`) artifact when testing is complete.

The test-only `test_fault_injection` command arms exactly one RAM-only fault:
`camera_dqbuf_timeout_once`, `usb_tx_zero_progress_once`, or
`usb_tx_partial_once`. State is not persisted and is cleared by reboot. The
arm acknowledgement is sent before the next eligible response can consume a
USB fault; heartbeats, startup messages, and capability status messages never
consume USB faults. Camera faults are consumed only by DQBUF on the next camera
capability command.

Only write the test artifact to `ota_0` at `0x20000`. Do not alter otadata,
ota_1, bootloader, partition table, NVS, assets, or coredump. Keep ota_1 as
the recovery fallback. After all three on-device tests pass, restore the
normal artifact to ota_0.
