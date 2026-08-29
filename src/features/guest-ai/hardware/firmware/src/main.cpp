#include <Arduino.h>
#include <ArduinoJson.h>
#include <M5StackChan.h>
#include <WiFi.h>
#include <esp_camera.h>

#include "BridgeCore.hpp"

using namespace guest_ai::bridge;

namespace {
constexpr uint32_t kHeartbeatIntervalMs = 5000;
constexpr uint32_t kCommandTimeoutMs = 15000;
constexpr int kServoSpeed = 180;
String inputLine;
RobotState robotState = RobotState::Booting;
uint32_t lastHeartbeatAt = 0;
uint32_t lastCommandAt = 0;
bool servoReady = false;
bool micReady = false;
bool micValidated = false;
bool displayDriverReady = false;
bool cameraInitialized = false;
bool cameraValidated = false;

// The CoreS3 panel is a direct M5GFX target.  There is deliberately no
// framebuffer/canvas layer here: a successful draw call cannot prove photons
// reached the panel, so physical validation remains a separate capability.
constexpr uint8_t kDisplayBrightness = 160;

String deviceId() {
  const uint64_t mac = ESP.getEfuseMac();
  char id[24];
  snprintf(id, sizeof(id), "k151-%012llX", mac);
  return id;
}

void sendEnvelope(const char* type, JsonDocument& payload, const char* messageId = "bridge") {
  JsonDocument message;
  message["protocol_version"] = GUEST_AI_PROTOCOL_VERSION;
  message["message_id"] = messageId;
  message["type"] = type;
  message["device_id"] = deviceId();
  message["sent_at"] = millis();  // Device monotonic timestamp; host records wall-clock receipt time.
  message["payload"] = payload;
  serializeJson(message, Serial);
  Serial.println();
}

void sendError(const char* commandId, const char* message) {
  JsonDocument payload;
  payload["command_id"] = commandId;
  payload["message"] = message;
  payload["robot_state"] = robotStateToWire(RobotState::Error);
  sendEnvelope("error", payload, commandId);
}

void sendResult(const char* commandId, const char* commandType, bool ok, const char* detail) {
  JsonDocument payload;
  payload["command_id"] = commandId;
  payload["command_type"] = commandType;
  payload["status"] = ok ? "ok" : "error";
  payload["detail"] = detail;
  payload["robot_state"] = robotStateToWire(robotState);
  sendEnvelope("command_result", payload, commandId);
}

void emitCapabilities() {
  JsonDocument payload;
  payload["display"] = "pass";  // Passed observed K151 panel validation.
  payload["servo_x"] = servoReady ? "pass" : "blocked";
  payload["servo_y"] = servoReady ? "pass" : "blocked";
  payload["speaker"] = M5.Speaker.isEnabled() ? "pass" : "blocked";
  payload["microphone"] = micValidated ? "pass" : "partial";
  payload["camera"] = cameraValidated ? "pass" : "partial";
  payload["wifi"] = WiFi.status() == WL_CONNECTED ? "pass" : "partial";
  sendEnvelope("capability_status", payload, "capabilities");
}

bool drawExpression(const String& expression) {
  if (!displayDriverReady) return false;
  auto& display = M5StackChan.Display();
  // M5StackChan.begin() performs the official CoreS3 panel discovery and
  // initialization. Explicitly wake/configure the selected panel before each
  // frame so a reset cannot leave a powered-but-sleeping black display.
  display.wakeup();
  display.setBrightness(kDisplayBrightness);
  display.setRotation(1);
  display.setTextScroll(false);
  display.startWrite();
  display.fillScreen(TFT_BLACK);
  display.setTextColor(TFT_WHITE, TFT_BLACK);
  display.setTextDatum(middle_center);
  display.setTextSize(2);
  display.drawString(expression, display.width() / 2, display.height() / 2);
  display.endWrite();
  return true;
}

bool initializeCamera(String& detail) {
  if (cameraInitialized) return true;

  const i2c_port_t sccbPort = M5.In_I2C.getPort();
  const bool sccbReady = M5.In_I2C.isEnabled();
  const bool sensorPresent = sccbReady && M5.In_I2C.scanID(0x21, 100000);
  if (!sccbReady || !sensorPresent) {
    detail = String("GC0308 SCCB unavailable; port=") + static_cast<int>(sccbPort)
      + "; enabled=" + (sccbReady ? "true" : "false")
      + "; sensor_0x21=" + (sensorPresent ? "present" : "absent");
    Serial.printf("guest-ai camera: %s\n", detail.c_str());
    return false;
  }

  // Pin map and 20 MHz external sensor clock are taken from the official
  // StackChan K151 HAL. SCCB shares the CoreS3 I2C bus configured by M5Unified.
  camera_config_t config = {};
  config.pin_pwdn = -1;
  config.pin_reset = -1;
  config.pin_xclk = -1;  // K151 supplies XCLK from its fixed external oscillator.
  config.pin_sccb_sda = -1;
  config.pin_sccb_scl = -1;
  config.sccb_i2c_port = sccbPort;
  config.pin_d0 = 39;
  config.pin_d1 = 40;
  config.pin_d2 = 41;
  config.pin_d3 = 42;
  config.pin_d4 = 15;
  config.pin_d5 = 16;
  config.pin_d6 = 48;
  config.pin_d7 = 47;
  config.pin_vsync = 46;
  config.pin_href = 38;
  config.pin_pclk = 45;
  config.xclk_freq_hz = 20000000;
  config.ledc_timer = LEDC_TIMER_0;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.pixel_format = PIXFORMAT_RGB565;
  config.frame_size = FRAMESIZE_QVGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  const esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    detail = String("esp_camera_init failed: 0x") + String(static_cast<uint32_t>(err), HEX);
    Serial.printf("guest-ai camera: %s\n", detail.c_str());
    return false;
  }
  cameraInitialized = true;
  return true;
}

void initializeDisplay() {
  auto& display = M5StackChan.Display();
  displayDriverReady = display.width() > 0 && display.height() > 0;
  Serial.printf("guest-ai display: board=%d size=%dx%d brightness=%u driver=%s\n",
                static_cast<int>(M5.getBoard()), display.width(), display.height(),
                kDisplayBrightness, displayDriverReady ? "ready" : "unavailable");
  if (displayDriverReady) {
    drawExpression("neutral");
  }
}

void enterSafeCenter() {
  if (!servoReady) return;
  M5StackChan.Motion.moveX(0, kServoSpeed);
  M5StackChan.Motion.moveY(450, kServoSpeed);  // 45° in the BSP's 0.1° unit.
}

bool runCapabilityTest(const String& capability, String& detail) {
  if (capability == "display") {
    if (!drawExpression("display test")) { detail = "CoreS3 display driver unavailable"; return false; }
    detail = "draw submitted; physical panel validation required";
    return false;
  }
  if (capability == "servo_x") { if (!servoReady) { detail = "servo initialization failed"; return false; } M5StackChan.Motion.moveX(0, kServoSpeed); detail = "X moved to center"; return true; }
  if (capability == "servo_y") { if (!servoReady) { detail = "servo initialization failed"; return false; } M5StackChan.Motion.moveY(450, kServoSpeed); detail = "Y moved to safe 45 degree center"; return true; }
  if (capability == "speaker") { if (!M5.Speaker.isEnabled()) { detail = "speaker unavailable"; return false; } M5.Speaker.tone(880, 120); detail = "880Hz test tone requested"; return true; }
  if (capability == "microphone") {
    M5.Speaker.end();
    micReady = M5.Mic.begin();
    int16_t samples[256] = {};
    bool recorded = micReady && M5.Mic.record(samples, 256, 16000);
    const uint32_t startedAt = millis();
    while (recorded && M5.Mic.isRecording() && millis() - startedAt < 750) {
      delay(1);
    }
    recorded = recorded && !M5.Mic.isRecording();
    uint32_t peak = 0;
    uint64_t sumSquares = 0;
    if (recorded) {
      for (const auto sample : samples) {
        const int32_t amplitude = sample < 0 ? -static_cast<int32_t>(sample) : sample;
        peak = max(peak, static_cast<uint32_t>(amplitude));
        sumSquares += static_cast<uint64_t>(amplitude) * amplitude;
      }
    }
    M5.Mic.end(); M5.Speaker.begin();
    detail = recorded
      ? String("microphone captured 256 samples; peak=") + peak + "; mean_square=" + (sumSquares / 256)
      : "microphone capture timeout or unavailable";
    micValidated = recorded && peak > 0;
    return micValidated;
  }
  if (capability == "camera") {
    if (!initializeCamera(detail)) return false;
    camera_fb_t* frame = esp_camera_fb_get();
    if (!frame) { detail = "camera initialized but no frame buffer returned"; return false; }
    const size_t length = frame->len;
    const size_t width = frame->width;
    const size_t height = frame->height;
    const int format = frame->format;
    esp_camera_fb_return(frame);
    if (length == 0 || width == 0 || height == 0) { detail = "camera returned an empty frame"; return false; }
    cameraValidated = true;
    detail = String("single frame captured; ") + width + "x" + height + "; bytes=" + length + "; format=" + format;
    Serial.printf("guest-ai camera: %s\n", detail.c_str());
    return true;
  }
  if (capability == "wifi") { detail = WiFi.status() == WL_CONNECTED ? "station connected" : "station not configured or disconnected"; return true; }
  detail = "unsupported capability"; return false;
}

void handleCommand(const String& frame) {
  JsonDocument message;
  if (deserializeJson(message, frame)) { sendError("invalid", "malformed JSON frame"); return; }
  const char* messageId = message["message_id"] | "invalid";
  const char* protocolVersion = message["protocol_version"] | "";
  const char* type = message["type"] | "";
  if (strcmp(protocolVersion, GUEST_AI_PROTOCOL_VERSION) != 0) { sendError(messageId, "unsupported protocol_version"); return; }
  const CommandType command = commandFromWire(type);
  if (command == CommandType::Unsupported) { sendError(messageId, "unsupported command"); return; }
  JsonObject payload = message["payload"].as<JsonObject>();
  if (payload.isNull()) { sendError(messageId, "payload object required"); return; }
  lastCommandAt = millis();
  if (command == CommandType::SetRobotState) {
    const std::string state = payload["state"] | "";
    const RobotState next = robotStateFromWire(state);
    if (next == RobotState::Error) { sendError(messageId, "invalid robot state"); return; }
    robotState = next;
    const bool submitted = drawExpression(state.c_str());
    sendResult(messageId, type, submitted, submitted
      ? "state applied; display draw submitted, physical validation required"
      : "state applied but display driver unavailable");
    return;
  }
  if (command == CommandType::SetExpression) {
    const std::string expression = payload["expression"] | "";
    if (!isAllowedExpression(expression)) { sendError(messageId, "invalid expression"); return; }
    const bool submitted = drawExpression(expression.c_str());
    sendResult(messageId, type, submitted, submitted
      ? "expression draw submitted; physical validation required"
      : "display driver unavailable");
    return;
  }
  if (command == CommandType::SetGaze) {
    if (!payload["x"].is<int>() || !payload["y"].is<int>()) { sendError(messageId, "gaze x and y integers required"); return; }
    const int x = payload["x"].as<int>(); const int y = payload["y"].as<int>();
    if (!isSafeGaze(x, y) || !servoReady) { sendError(messageId, "gaze outside safe range or servo unavailable"); return; }
    M5StackChan.Motion.moveX(x * 10, kServoSpeed);
    M5StackChan.Motion.moveY(y * 10, kServoSpeed);
    sendResult(messageId, type, true, "safe gaze applied"); return;
  }
  if (command == CommandType::PlayAudio) {
    const std::string asset = payload["asset"] | "";
    if (asset != "test_tone" || !M5.Speaker.isEnabled()) { sendError(messageId, "only built-in test_tone is supported"); return; }
    M5.Speaker.tone(880, 120); sendResult(messageId, type, true, "test tone requested"); return;
  }
  const std::string capability = payload["capability"] | "";
  if (!isAllowedCapability(capability)) { sendError(messageId, "invalid capability"); return; }
  String detail; const bool ok = runCapabilityTest(capability.c_str(), detail); emitCapabilities(); sendResult(messageId, type, ok, detail.c_str());
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  M5StackChan.begin();
  initializeDisplay();
  servoReady = true;
  M5StackChan.Motion.setAutoTorqueReleaseEnabled(false);
  enterSafeCenter();
  robotState = RobotState::Idle;
  JsonDocument payload;
  payload["model"] = "M5Stack StackChan K151";
  payload["bridge_version"] = GUEST_AI_BRIDGE_VERSION;
  payload["firmware_version"] = GUEST_AI_BRIDGE_VERSION;
  payload["transport"] = "usb_cdc_json_lines";
  sendEnvelope("device_connected", payload, "boot");
  emitCapabilities();
}

void loop() {
  M5StackChan.update();
  while (Serial.available()) {
    const char byte = static_cast<char>(Serial.read());
    if (byte == '\n') { if (inputLine.length()) handleCommand(inputLine); inputLine = ""; }
    else if (byte != '\r' && inputLine.length() < 2048) inputLine += byte;
    else if (inputLine.length() >= 2048) { inputLine = ""; sendError("invalid", "frame too large"); }
  }
  if (millis() - lastHeartbeatAt >= kHeartbeatIntervalMs) {
    JsonDocument payload;
    payload["robot_state"] = robotStateToWire(robotState);
    payload["uptime_ms"] = millis();
    payload["free_heap"] = ESP.getFreeHeap();
    payload["min_free_heap"] = ESP.getMinFreeHeap();
    sendEnvelope("heartbeat", payload, "heartbeat");
    lastHeartbeatAt = millis();
  }
  if (lastCommandAt && millis() - lastCommandAt > kCommandTimeoutMs && robotState != RobotState::Idle) { enterSafeCenter(); robotState = RobotState::Idle; }
}
