# FeedX Guest AI Device Protocol v1

Transport is newline-delimited UTF-8 JSON. The protocol is device-neutral: K151 is an adapter implementation, not a protocol type. Every envelope has `protocol_version`, `message_id`, `type`, `device_id`, `sent_at`, and object `payload`.

Device → FeedX required event types: `device_connected`, `heartbeat`, `capability_status`, `sensor_event`, `command_result`, `error`.

FeedX → device command types: `set_expression`, `set_gaze`, `play_audio`, `set_robot_state`, `request_capability_test`.

Example handshake:

```json
{"protocol_version":"1.0","message_id":"boot-1","type":"device_connected","device_id":"k151-serial","sent_at":"2026-08-22T00:00:00.000Z","payload":{"model":"M5Stack StackChan K151","firmware_version":"bridge-0.1.0"}}
```

The console does not treat an open serial port as a connected robot. Only a valid `device_connected` envelope moves the session online. Capability values are device-reported (`pass`, `partial`, `blocked`, or future adapter-specific metadata); the UI does not infer a pass result.
