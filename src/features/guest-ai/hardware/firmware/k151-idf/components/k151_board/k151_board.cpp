#include "k151_board.hpp"
#include "feetech_scscl.hpp"
#include "speaker_playback_state.hpp"
#include "mic_rx_lifecycle.hpp"
#include "capture_evidence.hpp"
#include "camera_device_registration.hpp"

#include <algorithm>
#include <cmath>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <iterator>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <driver/i2c_master.h>
#include <driver/i2s_std.h>
#include <driver/i2s_tdm.h>
#include <driver/spi_master.h>
#include <driver/uart.h>
#include <esp_codec_dev.h>
#include <esp_codec_dev_defaults.h>
#include <esp_check.h>
#include <esp_heap_caps.h>
#include <esp_lcd_ili9341.h>
#include <esp_lcd_panel_io.h>
#include <esp_lcd_panel_ops.h>
#include <esp_log.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <esp_video_device.h>
#include <esp_video_init.h>
#include <esp_video_ioctl.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
#include <freertos/task.h>
#include <linux/videodev2.h>

namespace guest_ai::k151 {
namespace {
constexpr gpio_num_t kI2cSda = GPIO_NUM_12, kI2cScl = GPIO_NUM_11;
constexpr uint8_t kPmic = 0x34, kExpander = 0x58;
constexpr gpio_num_t kLcdMosi = GPIO_NUM_37, kLcdSclk = GPIO_NUM_36, kLcdCs = GPIO_NUM_3, kLcdDc = GPIO_NUM_35;
constexpr gpio_num_t kI2sMclk = GPIO_NUM_0, kI2sWs = GPIO_NUM_33, kI2sBclk = GPIO_NUM_34, kI2sDout = GPIO_NUM_13, kI2sDin = GPIO_NUM_14;
constexpr int kSampleRate = 24000;
constexpr int kSpeakerVolume = 70;  // Factory StackChan default output volume.
constexpr size_t kSpeakerToneSamples = kSampleRate * 120 / 1000;
constexpr int16_t kSpeakerToneAmplitude = 6000;
// The protocol playback worker writes at most 4 KiB at a time.  At the
// factory 24 kHz / S16LE / mono codec contract that final block represents
// about 86 ms of audio, so leave a bounded DMA-drain interval before muting.
constexpr uint32_t kSpeakerPlaybackDrainMs = 100;
// AW88298 register addresses from the fixed esp_codec_dev 1.5.4 dependency.
// Keep these here rather than including its private device header so the board
// boundary remains buildable against the locked public component interface.
constexpr int kAw88298ChipVersionRegister = 0x00;
constexpr int kAw88298SystemStatusRegister = 0x01;
constexpr int kAw88298SystemControlRegister = 0x04;
constexpr int kAw88298SystemControl2Register = 0x05;
constexpr int kAw88298I2sControlRegister = 0x06;
constexpr int kAw88298VolumeRegister = 0x0C;
constexpr int kAw88298HagcStatusRegister = 0x10;
constexpr int kAw88298VddRegister = 0x12;
constexpr int kAw88298PvddRegister = 0x14;
constexpr const char* kTag = "k151";

struct Board {
  i2c_master_bus_handle_t i2c{};
  i2c_master_dev_handle_t pmic{}, expander{}, touch{};
  esp_lcd_panel_io_handle_t lcd_io{};
  esp_lcd_panel_handle_t lcd{};
  i2s_chan_handle_t tx{}, rx{};
  const audio_codec_data_if_t* data_if{};
  const audio_codec_ctrl_if_t* mic_ctrl{};
  const audio_codec_ctrl_if_t* speaker_ctrl{};
  const audio_codec_if_t* mic_codec{};
  const audio_codec_if_t* speaker_codec{};
  const audio_codec_gpio_if_t* codec_gpio{};
  esp_codec_dev_handle_t mic{}, speaker{};
  MicRxLifecycle mic_rx{};
  bool speaker_playback_active{};
  int camera_fd{-1};
  CameraInitState camera_init_state{CameraInitState::Uninitialized};
  bool servo_uart{};
  bool yaw_servo_discovered{};
  bool pitch_servo_discovered{};
  bool ready{};
  esp_err_t init_error{ESP_OK};
} g;

constexpr int kDisplayWidth = 320;
constexpr int kDisplayHeight = 240;
constexpr size_t kDisplayFrameBytes = kDisplayWidth * kDisplayHeight * sizeof(uint16_t);
uint16_t* g_display_frame{};
StaticSemaphore_t g_lcd_transfer_done_storage;
SemaphoreHandle_t g_lcd_transfer_done{};
uint32_t g_init_stack_high_water_words{};
uint32_t g_runtime_stack_high_water_words{};

struct LcdInitCommand {
  uint8_t command;
  uint8_t data[15];
  uint8_t data_size;
  uint16_t delay_ms;
};

// Exact ILI9342E extension sequence from StackChan factory v1.5.1.
constexpr LcdInitCommand kIli9342eInitCommands[] = {
    {0xDD, {0x01}, 1, 0}, {0x3A, {0x55}, 1, 0}, {0x21, {}, 0, 0}, {0x36, {0x08}, 1, 0},
    {0xD5, {0x00}, 1, 0}, {0xB1, {0x22}, 1, 0}, {0xC8, {0x38}, 1, 0}, {0xCB, {0x1C}, 1, 0},
    {0xC9, {0x1A}, 1, 0}, {0xCA, {0x1A}, 1, 0}, {0xB7, {0x5A, 0x41, 0x11, 0x19}, 4, 0},
    {0xE4, {0x04, 0x08, 0x11, 0x06, 0x12, 0x07, 0x3A, 0x76, 0x47, 0x07, 0x0F, 0x0A, 0x11, 0x19, 0x05}, 15, 0},
    {0xE5, {0x02, 0x03, 0x07, 0x06, 0x12, 0x07, 0x36, 0x5F, 0x48, 0x06, 0x10, 0x0C, 0x16, 0x14, 0x09}, 15, 0},
    {0x11, {}, 0, 120}, {0x29, {}, 0, 120},
};

esp_err_t run_init_stage(const char* stage, esp_err_t (*initializer)()) {
  ESP_LOGI(kTag, "init stage: %s (stack HWM=%u words)", stage,
           static_cast<unsigned>(uxTaskGetStackHighWaterMark(nullptr)));
  const esp_err_t result = initializer();
  if (result != ESP_OK) {
    ESP_LOGE(kTag, "init stage failed: %s (%s)", stage, esp_err_to_name(result));
  } else {
    ESP_LOGI(kTag, "init stage PASS: %s", stage);
  }
  return result;
}

// Extracted from the official StackChan FEETECH SCSCL transport: End=1 (big-endian
// words), UART1 GPIO6/7 at 1 Mbps, servo IDs yaw=1/pitch=2.
esp_err_t servo_transmit(const uint8_t* packet, size_t packet_size) {
  uart_flush_input(UART_NUM_1);
  if (uart_write_bytes(UART_NUM_1, packet, packet_size) != static_cast<int>(packet_size)) return ESP_FAIL;
  return uart_wait_tx_done(UART_NUM_1, pdMS_TO_TICKS(100));
}

esp_err_t servo_read_exact(uint8_t* response, size_t response_size) {
  const int read = uart_read_bytes(UART_NUM_1, response, response_size, pdMS_TO_TICKS(80));
  return read == static_cast<int>(response_size) ? ESP_OK : ESP_ERR_TIMEOUT;
}

esp_err_t servo_ping(uint8_t id, uint8_t* status) {
  uint8_t packet[6]{};
  feetech::encode_ping_packet(id, packet);
  ESP_RETURN_ON_ERROR(servo_transmit(packet, sizeof(packet)), kTag, "servo ping TX");
  uint8_t response[6]{};
  ESP_RETURN_ON_ERROR(servo_read_exact(response, sizeof(response)), kTag, "servo ping RX");
  if (!feetech::validate_status_packet(response, sizeof(response), id, status)) return ESP_ERR_INVALID_RESPONSE;
  return *status == 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t servo_read_register(uint8_t id, uint8_t address, uint8_t bytes, uint8_t* data, uint8_t* status) {
  uint8_t packet[8]{};
  feetech::encode_read_packet(id, address, bytes, packet);
  ESP_RETURN_ON_ERROR(servo_transmit(packet, sizeof(packet)), kTag, "servo read TX");
  uint8_t response[8]{};
  const size_t response_size = static_cast<size_t>(bytes) + 6;
  ESP_RETURN_ON_ERROR(servo_read_exact(response, response_size), kTag, "servo read RX");
  if (!feetech::validate_read_packet(response, response_size, id, bytes, status)) return ESP_ERR_INVALID_RESPONSE;
  if (*status != 0) return ESP_FAIL;
  std::memcpy(data, response + 5, bytes);
  return ESP_OK;
}

esp_err_t servo_write_position(uint8_t id, uint16_t position, uint16_t time, uint16_t speed) {
  uint8_t packet[13]{};
  feetech::encode_position_packet(id, position, time, speed, packet);
  ESP_LOGI(kTag, "servo TX id=%u reg=%u position=%u bytes=%02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X %02X",
           id, feetech::kGoalPositionRegister, position, packet[0], packet[1], packet[2], packet[3], packet[4], packet[5],
           packet[6], packet[7], packet[8], packet[9], packet[10], packet[11], packet[12]);
  ESP_RETURN_ON_ERROR(servo_transmit(packet, sizeof(packet)), kTag, "servo position TX");
  uint8_t response[6]{};
  ESP_RETURN_ON_ERROR(servo_read_exact(response, sizeof(response)), kTag, "servo position ACK RX");
  uint8_t status{};
  if (!feetech::validate_status_packet(response, sizeof(response), id, &status)) return ESP_ERR_INVALID_RESPONSE;
  ESP_LOGI(kTag, "servo ACK id=%u status=%u", id, status);
  return status == 0 ? ESP_OK : ESP_FAIL;
}

esp_err_t write_reg(i2c_master_dev_handle_t dev, uint8_t reg, uint8_t value) {
  const uint8_t bytes[] = {reg, value};
  return i2c_master_transmit(dev, bytes, sizeof(bytes), 100);
}

esp_err_t add_i2c_device(uint8_t address, i2c_master_dev_handle_t* handle) {
  i2c_device_config_t cfg{}; cfg.dev_addr_length = I2C_ADDR_BIT_LEN_7; cfg.device_address = address; cfg.scl_speed_hz = 100000;
  return i2c_master_bus_add_device(g.i2c, &cfg, handle);
}

esp_err_t reset_ili9342() {
  // StackChan factory: AW9523 P1.1 is the LCD reset line.
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x03, 0x81), kTag, "ILI9342 reset assert");
  vTaskDelay(pdMS_TO_TICKS(20));
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x03, 0x83), kTag, "ILI9342 reset release");
  vTaskDelay(pdMS_TO_TICKS(10));
  return ESP_OK;
}

esp_err_t reset_aw88298() {
  // Official StackChan Aw9523::ResetAw88298() sequence.  The bridge can boot
  // after another OTA application has left the amplifier in an arbitrary
  // state, so merely writing the expander's initial output level is not a
  // substitute for this pulse.
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x02, 0x03), kTag, "AW88298 reset assert");
  vTaskDelay(pdMS_TO_TICKS(10));
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x02, 0x07), kTag, "AW88298 reset release");
  vTaskDelay(pdMS_TO_TICKS(50));
  ESP_LOGI(kTag, "init stage PASS: aw88298_reset");
  return ESP_OK;
}

esp_err_t log_aw88298_runtime_state() {
  struct Register {
    const char* name;
    int address;
  };
  constexpr Register registers[] = {
      {"chip", kAw88298ChipVersionRegister}, {"sysst", kAw88298SystemStatusRegister},
      {"sysctrl", kAw88298SystemControlRegister}, {"sysctrl2", kAw88298SystemControl2Register},
      {"i2s", kAw88298I2sControlRegister}, {"volume", kAw88298VolumeRegister},
      {"hagc", kAw88298HagcStatusRegister}, {"vdd", kAw88298VddRegister}, {"pvdd", kAw88298PvddRegister},
  };
  int values[std::size(registers)]{};
  for (size_t index = 0; index < std::size(registers); ++index) {
    const int result = esp_codec_dev_read_reg(g.speaker, registers[index].address, &values[index]);
    if (result != ESP_CODEC_DEV_OK) {
      ESP_LOGE(kTag, "speaker_diag register=%s read=%d", registers[index].name, result);
      return ESP_FAIL;
    }
  }
  if (values[0] != 0x1852) {
    ESP_LOGE(kTag, "speaker_diag unexpected_chip=0x%04X", values[0]);
    return ESP_ERR_INVALID_RESPONSE;
  }
  ESP_LOGI(kTag,
           "speaker_diag_regs chip=0x%04X sysst=0x%04X sysctrl=0x%04X sysctrl2=0x%04X i2s=0x%04X volume=0x%04X hagc=0x%04X vdd=0x%04X pvdd=0x%04X",
           values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7], values[8]);
  return ESP_OK;
}

bool is_ili9342e() {
  uint8_t register_address = 0xA3;
  uint8_t info[6]{};
  const esp_err_t result = i2c_master_transmit_receive(g.touch, &register_address, sizeof(register_address), info, sizeof(info), 100);
  if (result != ESP_OK) {
    ESP_LOGW(kTag, "FT6336 panel variant probe failed: %s; using ILI9342C path", esp_err_to_name(result));
    return false;
  }
  const bool is_9342e = info[3] == 0x12 && info[5] == 0x11;
  ESP_LOGI(kTag, "FT6336 panel variant: firm=0x%02X vendor=0x%02X (%s)", info[3], info[5], is_9342e ? "ILI9342E" : "ILI9342C");
  return is_9342e;
}

esp_err_t apply_ili9342e_init() {
  for (const auto& command : kIli9342eInitCommands) {
    const void* data = command.data_size == 0 ? nullptr : command.data;
    ESP_RETURN_ON_ERROR(esp_lcd_panel_io_tx_param(g.lcd_io, command.command, data, command.data_size), kTag, "ILI9342E command");
    if (command.delay_ms) vTaskDelay(pdMS_TO_TICKS(command.delay_ms));
  }
  return ESP_OK;
}

// esp_lcd_panel_draw_bitmap() is asynchronous for SPI panels. The former 640-byte
// scanline was overwritten while queued DMA transactions still referenced it. Keep
// one DMA-capable full frame alive until the panel IO completion callback fires.
bool IRAM_ATTR lcd_color_transfer_done(esp_lcd_panel_io_handle_t, esp_lcd_panel_io_event_data_t*, void*) {
  BaseType_t higher_priority_task_woken = pdFALSE;
  xSemaphoreGiveFromISR(g_lcd_transfer_done, &higher_priority_task_woken);
  return higher_priority_task_woken == pdTRUE;
}

constexpr uint16_t panel_rgb565(uint16_t rgb565) {
  // Factory LVGL port enables swap_bytes=1; direct esp_lcd buffers need the same
  // wire byte order (MSB first) for RGB565 color data.
  return static_cast<uint16_t>((rgb565 << 8) | (rgb565 >> 8));
}

void drain_lcd_completion() {
  while (xSemaphoreTake(g_lcd_transfer_done, 0) == pdTRUE) {}
}

esp_err_t submit_display_frame_and_wait(const char* marker) {
  if (!g.lcd || !g_display_frame || !g_lcd_transfer_done) return ESP_ERR_INVALID_STATE;
  drain_lcd_completion();
  const esp_err_t result = esp_lcd_panel_draw_bitmap(g.lcd, 0, 0, kDisplayWidth, kDisplayHeight, g_display_frame);
  if (result != ESP_OK) {
    ESP_LOGE(kTag, "DISPLAY_TEST:draw_error stage=%s err=%s", marker, esp_err_to_name(result));
    return result;
  }
  if (xSemaphoreTake(g_lcd_transfer_done, pdMS_TO_TICKS(5000)) != pdTRUE) {
    ESP_LOGE(kTag, "DISPLAY_TEST:draw_error stage=%s err=ESP_ERR_TIMEOUT", marker);
    return ESP_ERR_TIMEOUT;
  }
  ESP_LOGI(kTag, "DISPLAY_TEST:%s", marker);
  return ESP_OK;
}

esp_err_t fill_display(uint16_t color, const char* marker) {
  std::fill_n(g_display_frame, kDisplayWidth * kDisplayHeight, panel_rgb565(color));
  return submit_display_frame_and_wait(marker);
}

esp_err_t fill_rgb_bands() {
  for (int y = 0; y < kDisplayHeight; ++y) {
    const uint16_t color = y < 80 ? 0xF800 : (y < 160 ? 0x07E0 : 0x001F);
    std::fill_n(g_display_frame + y * kDisplayWidth, kDisplayWidth, panel_rgb565(color));
  }
  return submit_display_frame_and_wait("rgb_bands");
}

void draw_rect(int left, int top, int right_exclusive, int bottom_exclusive, uint16_t color) {
  const int clamped_left = std::max(0, left);
  const int clamped_top = std::max(0, top);
  const int clamped_right = std::min(kDisplayWidth, right_exclusive);
  const int clamped_bottom = std::min(kDisplayHeight, bottom_exclusive);
  for (int y = clamped_top; y < clamped_bottom; ++y) {
    std::fill_n(g_display_frame + y * kDisplayWidth + clamped_left,
                std::max(0, clamped_right - clamped_left), panel_rgb565(color));
  }
}

// This deliberately remains a minimal renderer: it gives the physical LCD gate a
// visible neutral face without introducing an avatar or interaction engine.
esp_err_t render_expression_frame(const char* expression, const char* marker) {
  std::fill_n(g_display_frame, kDisplayWidth * kDisplayHeight, panel_rgb565(0x0000));
  const uint16_t eye_color = std::strcmp(expression, "happy") == 0 ? 0xFFE0 : 0xFFFF;
  const bool blink = std::strcmp(expression, "blink") == 0;
  if (blink) {
    draw_rect(55, 100, 115, 108, eye_color);
    draw_rect(205, 100, 265, 108, eye_color);
  } else {
    draw_rect(55, 78, 115, 128, eye_color);
    draw_rect(205, 78, 265, 128, eye_color);
  }
  if (std::strcmp(expression, "listening") == 0) {
    draw_rect(110, 168, 210, 176, 0x07FF);
  } else if (std::strcmp(expression, "thinking") == 0) {
    draw_rect(110, 168, 210, 176, 0x7BEF);
  } else if (std::strcmp(expression, "speaking") == 0) {
    draw_rect(120, 160, 200, 188, 0xF81F);
  } else {
    draw_rect(110, 168, 210, 176, eye_color);
  }
  return submit_display_frame_and_wait(marker);
}

esp_err_t render_boot_baseline() {
  // Each completed physical transfer stays visible for one second for human validation.
  ESP_RETURN_ON_ERROR(fill_display(0x0000, "black"), kTag, "LCD black baseline");
  vTaskDelay(pdMS_TO_TICKS(1000));
  ESP_RETURN_ON_ERROR(fill_display(0xFFFF, "white"), kTag, "LCD white baseline");
  vTaskDelay(pdMS_TO_TICKS(1000));
  ESP_RETURN_ON_ERROR(fill_display(0xF800, "red"), kTag, "LCD red baseline");
  vTaskDelay(pdMS_TO_TICKS(1000));
  ESP_RETURN_ON_ERROR(fill_display(0x07E0, "green"), kTag, "LCD green baseline");
  vTaskDelay(pdMS_TO_TICKS(1000));
  ESP_RETURN_ON_ERROR(fill_display(0x001F, "blue"), kTag, "LCD blue baseline");
  vTaskDelay(pdMS_TO_TICKS(1000));
  ESP_RETURN_ON_ERROR(fill_rgb_bands(), kTag, "LCD RGB baseline");
  vTaskDelay(pdMS_TO_TICKS(1000));
  ESP_RETURN_ON_ERROR(render_expression_frame("neutral", "neutral"), kTag, "LCD neutral baseline");
  ESP_LOGI(kTag, "DISPLAY_TEST:complete");
  return ESP_OK;
}

esp_err_t init_i2c_and_power() {
  i2c_master_bus_config_t cfg{};
  cfg.i2c_port = I2C_NUM_1; cfg.sda_io_num = kI2cSda; cfg.scl_io_num = kI2cScl; cfg.clk_source = I2C_CLK_SRC_DEFAULT; cfg.glitch_ignore_cnt = 7; cfg.flags.enable_internal_pullup = true;
  ESP_RETURN_ON_ERROR(i2c_new_master_bus(&cfg, &g.i2c), "k151", "I2C1 init");
  ESP_RETURN_ON_ERROR(add_i2c_device(kPmic, &g.pmic), "k151", "AXP2101");
  ESP_RETURN_ON_ERROR(add_i2c_device(kExpander, &g.expander), "k151", "AW9523");
  ESP_RETURN_ON_ERROR(add_i2c_device(0x38, &g.touch), "k151", "FT6336");
  ESP_LOGI(kTag, "init stage PASS: i2c");
  // Factory StackChan v1.5.1 PMIC sequence, including the display rail and its
  // companion rails. The bridge enables DLDO1 before the diagnostic draw.
  uint8_t pmic_90{};
  const uint8_t pmic_90_reg = 0x90;
  ESP_RETURN_ON_ERROR(i2c_master_transmit_receive(g.pmic, &pmic_90_reg, 1, &pmic_90, 1, 100), "k151", "read PMIC 0x90");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x90, static_cast<uint8_t>(pmic_90 | 0xB4)), "k151", "PMIC rails pre-enable");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x97, 28), "k151", "PMIC display voltage");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x69, 0x35), "k151", "PMIC regulator config");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x30, 0x3F), "k151", "PMIC charge config");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x99, 28), "k151", "display voltage");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x90, 0xBF), "k151", "display rail");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x94, 28), "k151", "PMIC ALDO1 voltage");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x95, 28), "k151", "PMIC ALDO2 voltage");
  ESP_RETURN_ON_ERROR(write_reg(g.pmic, 0x27, 0x00), "k151", "PMIC sleep config");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x02, 0x07), "k151", "AW9523 P0");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x03, 0x8F), "k151", "AW9523 P1");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x04, 0x18), "k151", "AW9523 CONFIG_P0");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x05, 0x0C), "k151", "AW9523 CONFIG_P1");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x11, 0x10), "k151", "AW9523 GCR_P0");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x12, 0xFF), "k151", "AW9523 LEDMODE_P0");
  ESP_RETURN_ON_ERROR(write_reg(g.expander, 0x13, 0xFF), "k151", "AW9523 LEDMODE_P1");
  vTaskDelay(pdMS_TO_TICKS(50));  // Factory InitializeAw9523 settle time.
  ESP_RETURN_ON_ERROR(reset_aw88298(), "k151", "AW88298 hardware reset");
  ESP_LOGI(kTag, "init stage PASS: power");
  return ESP_OK;
}

esp_err_t init_display() {
  ESP_LOGI(kTag, "DISPLAY_TEST:panel_init_begin variant=ILI9342C rotation=0 mirror_x=0 mirror_y=0 pixel=RGB565/BGR spi_hz=40000000 transfer=%u size=%dx%d", static_cast<unsigned>(kDisplayFrameBytes), kDisplayWidth, kDisplayHeight);
  g_lcd_transfer_done = xSemaphoreCreateBinaryStatic(&g_lcd_transfer_done_storage);
  g_display_frame = static_cast<uint16_t*>(heap_caps_aligned_alloc(4, kDisplayFrameBytes, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL));
  if (!g_display_frame) return ESP_ERR_NO_MEM;
  spi_bus_config_t bus{}; bus.mosi_io_num = kLcdMosi; bus.sclk_io_num = kLcdSclk; bus.max_transfer_sz = kDisplayFrameBytes;
  ESP_RETURN_ON_ERROR(spi_bus_initialize(SPI3_HOST, &bus, SPI_DMA_CH_AUTO), "k151", "LCD SPI");
  esp_lcd_panel_io_spi_config_t io{}; io.cs_gpio_num = kLcdCs; io.dc_gpio_num = kLcdDc; io.spi_mode = 2; io.pclk_hz = 40 * 1000 * 1000; io.trans_queue_depth = 10; io.lcd_cmd_bits = 8; io.lcd_param_bits = 8; io.on_color_trans_done = lcd_color_transfer_done;
  ESP_RETURN_ON_ERROR(esp_lcd_new_panel_io_spi(SPI3_HOST, &io, &g.lcd_io), "k151", "LCD IO");
  esp_lcd_panel_dev_config_t panel{}; panel.reset_gpio_num = GPIO_NUM_NC; panel.rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR; panel.bits_per_pixel = 16;
  ESP_RETURN_ON_ERROR(esp_lcd_new_panel_ili9341(g.lcd_io, &panel, &g.lcd), "k151", "ILI9342");
  ESP_RETURN_ON_ERROR(esp_lcd_panel_reset(g.lcd), "k151", "LCD reset");
  ESP_RETURN_ON_ERROR(reset_ili9342(), "k151", "LCD hardware reset");
  ESP_RETURN_ON_ERROR(esp_lcd_panel_init(g.lcd), "k151", "LCD init");
  if (is_ili9342e()) ESP_RETURN_ON_ERROR(apply_ili9342e_init(), "k151", "ILI9342E init");
  ESP_RETURN_ON_ERROR(esp_lcd_panel_invert_color(g.lcd, true), "k151", "LCD invert");
  ESP_RETURN_ON_ERROR(esp_lcd_panel_swap_xy(g.lcd, false), "k151", "LCD swap XY");
  ESP_RETURN_ON_ERROR(esp_lcd_panel_mirror(g.lcd, false, false), "k151", "LCD mirror");
  ESP_RETURN_ON_ERROR(esp_lcd_panel_disp_on_off(g.lcd, true), "k151", "LCD display on");
  ESP_LOGI(kTag, "DISPLAY_TEST:panel_init_ok variant=ILI9342C rotation=0 mirror_x=0 mirror_y=0 pixel=RGB565/BGR spi_hz=40000000 transfer=%u draw=%dx%d", static_cast<unsigned>(kDisplayFrameBytes), kDisplayWidth, kDisplayHeight);
  return render_boot_baseline();
}

esp_err_t init_audio() {
  i2s_chan_config_t channels{}; channels.id = I2S_NUM_0; channels.role = I2S_ROLE_MASTER; channels.dma_desc_num = 6; channels.dma_frame_num = 240; channels.auto_clear_after_cb = true; channels.auto_clear_before_cb = false; channels.intr_priority = 0;
  ESP_RETURN_ON_ERROR(i2s_new_channel(&channels, &g.tx, &g.rx), "k151", "I2S0");
  i2s_std_config_t tx{}; tx.clk_cfg.sample_rate_hz = kSampleRate; tx.clk_cfg.clk_src = I2S_CLK_SRC_DEFAULT; tx.clk_cfg.ext_clk_freq_hz = 0; tx.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256; tx.slot_cfg.data_bit_width = I2S_DATA_BIT_WIDTH_16BIT; tx.slot_cfg.slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO; tx.slot_cfg.slot_mode = I2S_SLOT_MODE_STEREO; tx.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH; tx.slot_cfg.ws_width = I2S_DATA_BIT_WIDTH_16BIT; tx.slot_cfg.ws_pol = false; tx.slot_cfg.bit_shift = true; tx.slot_cfg.left_align = true; tx.slot_cfg.big_endian = false; tx.slot_cfg.bit_order_lsb = false; tx.gpio_cfg.mclk=kI2sMclk; tx.gpio_cfg.bclk=kI2sBclk; tx.gpio_cfg.ws=kI2sWs; tx.gpio_cfg.dout=kI2sDout; tx.gpio_cfg.din=I2S_GPIO_UNUSED;
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(g.tx, &tx), "k151", "I2S TX");
  i2s_tdm_config_t rx{}; rx.clk_cfg.sample_rate_hz=kSampleRate; rx.clk_cfg.clk_src=I2S_CLK_SRC_DEFAULT; rx.clk_cfg.ext_clk_freq_hz=0; rx.clk_cfg.mclk_multiple=I2S_MCLK_MULTIPLE_256; rx.clk_cfg.bclk_div=8; rx.slot_cfg.data_bit_width=I2S_DATA_BIT_WIDTH_16BIT; rx.slot_cfg.slot_bit_width=I2S_SLOT_BIT_WIDTH_AUTO; rx.slot_cfg.slot_mode=I2S_SLOT_MODE_STEREO; rx.slot_cfg.slot_mask=static_cast<i2s_tdm_slot_mask_t>(I2S_TDM_SLOT0|I2S_TDM_SLOT1|I2S_TDM_SLOT2|I2S_TDM_SLOT3); rx.slot_cfg.ws_width=I2S_TDM_AUTO_WS_WIDTH; rx.slot_cfg.ws_pol=false; rx.slot_cfg.bit_shift=true; rx.slot_cfg.left_align=false; rx.slot_cfg.big_endian=false; rx.slot_cfg.bit_order_lsb=false; rx.slot_cfg.skip_mask=false; rx.slot_cfg.total_slot=I2S_TDM_AUTO_SLOT_NUM; rx.gpio_cfg.mclk=kI2sMclk; rx.gpio_cfg.bclk=kI2sBclk; rx.gpio_cfg.ws=kI2sWs; rx.gpio_cfg.dout=I2S_GPIO_UNUSED; rx.gpio_cfg.din=kI2sDin;
  ESP_RETURN_ON_ERROR(i2s_channel_init_tdm_mode(g.rx, &rx), "k151", "I2S RX");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(g.tx), "k151", "I2S TX enable");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(g.rx), "k151", "I2S RX enable");
  // esp_codec_dev's I2S data interface expects the factory-created duplex
  // channels to be enabled before its first format transition.  It will own
  // all subsequent RX state changes once the persistent input session opens.
  g.mic_rx.initialized();
  ESP_LOGI(kTag, "init stage PASS: audio");
  audio_codec_i2s_cfg_t data_cfg{}; data_cfg.port=I2S_NUM_0; data_cfg.rx_handle=g.rx; data_cfg.tx_handle=g.tx; data_cfg.clk_src=I2S_CLK_SRC_DEFAULT; g.data_if=audio_codec_new_i2s_data(&data_cfg);
  audio_codec_i2c_cfg_t spk_i2c{.port=I2C_NUM_1,.addr=AW88298_CODEC_DEFAULT_ADDR,.bus_handle=g.i2c}; audio_codec_i2c_cfg_t mic_i2c{.port=I2C_NUM_1,.addr=ES7210_CODEC_DEFAULT_ADDR,.bus_handle=g.i2c};
  g.speaker_ctrl=audio_codec_new_i2c_ctrl(&spk_i2c); g.mic_ctrl=audio_codec_new_i2c_ctrl(&mic_i2c); g.codec_gpio=audio_codec_new_gpio();
  aw88298_codec_cfg_t aw{}; aw.ctrl_if=g.speaker_ctrl; aw.gpio_if=g.codec_gpio; aw.reset_pin=GPIO_NUM_NC; aw.hw_gain.pa_voltage=5.0; aw.hw_gain.codec_dac_voltage=3.3; aw.hw_gain.pa_gain=1; g.speaker_codec=aw88298_codec_new(&aw);
  es7210_codec_cfg_t es{}; es.ctrl_if=g.mic_ctrl; es.master_mode=false; es.mic_selected=ES7210_SEL_MIC1|ES7210_SEL_MIC2|ES7210_SEL_MIC3; es.mclk_src=ES7210_MCLK_FROM_PAD; es.mclk_div=I2S_MCLK_MULTIPLE_256; g.mic_codec=es7210_codec_new(&es);
  esp_codec_dev_cfg_t out{.dev_type=ESP_CODEC_DEV_TYPE_OUT,.codec_if=g.speaker_codec,.data_if=g.data_if}; esp_codec_dev_cfg_t in{.dev_type=ESP_CODEC_DEV_TYPE_IN,.codec_if=g.mic_codec,.data_if=g.data_if};
  g.speaker=esp_codec_dev_new(&out); g.mic=esp_codec_dev_new(&in);
  if (!(g.data_if && g.speaker && g.mic)) return ESP_ERR_NO_MEM;
  ESP_LOGI(kTag, "init stage PASS: microphone");
  return ESP_OK;
}

esp_err_t init_camera() {
  esp_cam_ctlr_dvp_pin_config_t pins{}; pins.data_width=CAM_CTLR_DATA_WIDTH_8;
  const gpio_num_t data[] = {GPIO_NUM_39,GPIO_NUM_40,GPIO_NUM_41,GPIO_NUM_42,GPIO_NUM_15,GPIO_NUM_16,GPIO_NUM_48,GPIO_NUM_47}; std::memcpy(pins.data_io, data, sizeof(data)); pins.vsync_io=GPIO_NUM_46; pins.de_io=GPIO_NUM_38; pins.pclk_io=GPIO_NUM_45; pins.xclk_io=GPIO_NUM_NC;
  esp_video_init_sccb_config_t sccb{.init_sccb=false,.i2c_handle=g.i2c,.freq=100000}; esp_video_init_dvp_config_t dvp{.sccb_config=sccb,.reset_pin=GPIO_NUM_NC,.pwdn_pin=GPIO_NUM_NC,.dvp_pin=pins,.xclk_freq=20000000}; esp_video_init_config_t video{.dvp=&dvp};
  const esp_err_t video_result = esp_video_init(&video);
  if (video_result != ESP_OK) {
    g.camera_init_state = CameraInitState::InitFailed;
    return video_result;
  }

  struct RealCameraNodeProbe {
    static int open_readwrite(void*, int* error) {
      errno = 0;
      const int fd = open(ESP_VIDEO_DVP_DEVICE_NAME, O_RDWR);
      if (fd < 0 && error) *error = errno;
      return fd;
    }
    static bool close_fd(void*, int fd, int* error) {
      errno = 0;
      const int result = close(fd);
      if (result != 0 && error) *error = errno;
      return result == 0;
    }
  };
  CameraVideoNodeProbeOps probe_ops{nullptr, RealCameraNodeProbe::open_readwrite, RealCameraNodeProbe::close_fd};
  int probe_errno = 0;
  const CameraVideoNodeProbeResult probe_result = probe_camera_video_node(probe_ops, &probe_errno);
  if (probe_result != CameraVideoNodeProbeResult::Ready) {
    g.camera_init_state = probe_result == CameraVideoNodeProbeResult::Missing
        ? CameraInitState::VideoDeviceMissing : CameraInitState::ProbeFailed;
    ESP_LOGE(kTag, "%s: node=%s errno=%d(%s)",
             g.camera_init_state == CameraInitState::VideoDeviceMissing ? "camera_video_device_missing" : "camera_video_device_probe_failed",
             ESP_VIDEO_DVP_DEVICE_NAME, probe_errno, std::strerror(probe_errno));
    return probe_result == CameraVideoNodeProbeResult::Missing ? ESP_ERR_NOT_FOUND : ESP_FAIL;
  }
  g.camera_init_state = CameraInitState::Ready;
  ESP_LOGI(kTag, "camera_video_device_registered: node=%s", ESP_VIDEO_DVP_DEVICE_NAME);
  return ESP_OK;
}

esp_err_t init_servo_uart() {
  uart_config_t cfg{}; cfg.baud_rate=1000000; cfg.data_bits=UART_DATA_8_BITS; cfg.parity=UART_PARITY_DISABLE; cfg.stop_bits=UART_STOP_BITS_1; cfg.flow_ctrl=UART_HW_FLOWCTRL_DISABLE; cfg.source_clk=UART_SCLK_DEFAULT;
  ESP_RETURN_ON_ERROR(uart_driver_install(UART_NUM_1, 256, 256, 0, nullptr, 0), "k151", "servo UART driver");
  ESP_RETURN_ON_ERROR(uart_param_config(UART_NUM_1, &cfg), "k151", "servo UART config");
  ESP_RETURN_ON_ERROR(uart_set_pin(UART_NUM_1, GPIO_NUM_6, GPIO_NUM_7, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE), "k151", "servo UART pins");
  g.servo_uart=true; return ESP_OK;
}

} // namespace

esp_err_t k151_board_init() {
  if (g.ready) return g.init_error;
  esp_err_t first_error = ESP_OK;
  const auto run = [&first_error](const char* stage, esp_err_t (*initializer)()) {
    const esp_err_t result = run_init_stage(stage, initializer);
    if (first_error == ESP_OK && result != ESP_OK) first_error = result;
  };

  // Each stage is isolated so an optional peripheral cannot prevent the USB gateway
  // from starting and reporting its own blocked capability.
  run("power_i2c", init_i2c_and_power);
  run("lcd", init_display);
  run("audio_microphone", init_audio);
  run("camera", init_camera);
  run("servo_transport", init_servo_uart);
  g.init_error = first_error;
  g.ready = true;
  return first_error;
}

esp_err_t k151_display_expression(const char* expression) { if (!g.lcd || !expression) return ESP_ERR_INVALID_STATE; return render_expression_frame(expression, expression); }

CameraInitState k151_camera_init_state() { return g.camera_init_state; }

esp_err_t k151_servo_center(){ return k151_servo_gaze(0,450); }
esp_err_t k151_servo_gaze(int x, int y) {
  if (!g.servo_uart || !feetech::is_safe_gaze(x, y)) return ESP_ERR_INVALID_ARG;
  // Position writes are blocked until both physical buses have passed the
  // non-motion ping/read discovery path in this boot session.
  if (!g.yaw_servo_discovered || !g.pitch_servo_discovered) return ESP_ERR_INVALID_STATE;
  ESP_RETURN_ON_ERROR(servo_write_position(feetech::kYawId, feetech::yaw_position(x),20,0), "k151", "yaw");
  return servo_write_position(feetech::kPitchId, feetech::pitch_position(y),20,0);
}
esp_err_t k151_servo_probe(uint8_t servo_id, ServoProbe* probe) {
  if (!g.servo_uart || !probe || (servo_id != feetech::kYawId && servo_id != feetech::kPitchId)) return ESP_ERR_INVALID_ARG;
  *probe = {};
  ESP_RETURN_ON_ERROR(servo_ping(servo_id, &probe->status), kTag, "servo ping");
  probe->ping_ok = true;
  uint8_t position[2]{};
  ESP_RETURN_ON_ERROR(servo_read_register(servo_id, feetech::kPresentPositionRegister, sizeof(position), position, &probe->status), kTag, "servo position read");
  probe->present_position = static_cast<uint16_t>((position[0] << 8) | position[1]);
  probe->position_ok = true;
  uint8_t torque{};
  ESP_RETURN_ON_ERROR(servo_read_register(servo_id, feetech::kTorqueEnableRegister, 1, &torque, &probe->status), kTag, "servo torque read");
  probe->torque_enabled = torque != 0;
  probe->torque_state_ok = true;
  if (servo_id == feetech::kYawId) g.yaw_servo_discovered = true;
  if (servo_id == feetech::kPitchId) g.pitch_servo_discovered = true;
  ESP_LOGI(kTag, "servo probe id=%u ping=1 position=%u torque_enabled=%u", servo_id, probe->present_position, probe->torque_enabled);
  return ESP_OK;
}
esp_err_t k151_speaker_test_tone() {
  if (!g.speaker || !g.tx) return ESP_ERR_INVALID_STATE;

  // Factory CoreS3 sequence: configure the duplex I2S channels, open the
  // AW88298 output device, apply output volume, then write PCM. The codec-dev
  // default volume is zero; without the explicit 70 setting its open path
  // rewrites AW88298 to approximately -96 dB and the tone is inaudible.
  esp_codec_dev_sample_info_t format{};
  format.bits_per_sample = 16;
  format.channel = 1;
  format.channel_mask = 0;
  format.sample_rate = kSampleRate;
  format.mclk_multiple = 0;

  SpeakerPlaybackState playback{};
  int codec_result = esp_codec_dev_open(g.speaker, &format);
  if (codec_result != ESP_CODEC_DEV_OK) {
    ESP_LOGE(kTag, "speaker_diag codec_open=%d", codec_result);
    return ESP_FAIL;
  }
  playback.codec_open = true;

  i2s_chan_info_t tx_info{};
  esp_err_t tx_info_result = i2s_channel_get_info(g.tx, &tx_info);
  if (tx_info_result != ESP_OK) {
    ESP_LOGE(kTag, "speaker_diag tx_info=%s", esp_err_to_name(tx_info_result));
    (void)esp_codec_dev_close(g.speaker);
    return tx_info_result;
  }
  if (!tx_info.is_enabled) {
    const esp_err_t enable_result = i2s_channel_enable(g.tx);
    ESP_LOGI(kTag, "speaker_diag tx_enable=%s", esp_err_to_name(enable_result));
    if (enable_result != ESP_OK) {
      (void)esp_codec_dev_close(g.speaker);
      return enable_result;
    }
    tx_info_result = i2s_channel_get_info(g.tx, &tx_info);
    if (tx_info_result != ESP_OK || !tx_info.is_enabled) {
      (void)esp_codec_dev_close(g.speaker);
      return tx_info_result == ESP_OK ? ESP_ERR_INVALID_STATE : tx_info_result;
    }
  }
  playback.tx_enabled = tx_info.is_enabled;

  const int volume_result = esp_codec_dev_set_out_vol(g.speaker, kSpeakerVolume);
  const int unmute_result = esp_codec_dev_set_out_mute(g.speaker, false);
  if (volume_result != ESP_CODEC_DEV_OK || unmute_result != ESP_CODEC_DEV_OK || !playback.can_write()) {
    ESP_LOGE(kTag, "speaker_diag volume=%d unmute=%d tx_enabled=%d", volume_result, unmute_result, playback.tx_enabled);
    (void)esp_codec_dev_close(g.speaker);
    return ESP_FAIL;
  }
  ESP_RETURN_ON_ERROR(log_aw88298_runtime_state(), kTag, "AW88298 runtime state");

  static int16_t samples[kSpeakerToneSamples];
  for (size_t i = 0; i < kSpeakerToneSamples; ++i) {
    samples[i] = static_cast<int16_t>(std::sin(2 * M_PI * 880 * i / kSampleRate) * kSpeakerToneAmplitude);
  }

  size_t bytes_written{};
  const int64_t write_start_us = esp_timer_get_time();
  const esp_err_t write_result = i2s_channel_write(g.tx, samples, sizeof(samples), &bytes_written, pdMS_TO_TICKS(1000));
  const int64_t write_latency_ms = (esp_timer_get_time() - write_start_us) / 1000;
  playback.pcm_fully_written = write_result == ESP_OK && bytes_written == sizeof(samples);
  ESP_LOGI(kTag,
           "speaker_diag tx_enabled=%d codec_open=%d volume=%d mute=0 pcm_requested=%u pcm_written=%u write_ms=%lld write=%s",
           playback.tx_enabled, playback.codec_open, kSpeakerVolume, static_cast<unsigned>(sizeof(samples)),
           static_cast<unsigned>(bytes_written), static_cast<long long>(write_latency_ms), esp_err_to_name(write_result));

  // Let DMA drain the complete 120 ms tone before muting. Keep the pre-enabled
  // TX channel parked afterwards: the component manager's next format change
  // can safely disable it, avoiding an unenabled-channel disable call.
  if (playback.pcm_fully_written) vTaskDelay(pdMS_TO_TICKS(130));
  const int mute_result = esp_codec_dev_set_out_mute(g.speaker, true);
  const int close_result = esp_codec_dev_close(g.speaker);
  i2s_chan_info_t parked_info{};
  esp_err_t park_result = i2s_channel_get_info(g.tx, &parked_info);
  if (park_result == ESP_OK && !parked_info.is_enabled) {
    // codec-dev close disables an active output. Restore the factory-style
    // parked TX state so the next open's internal reconfiguration owns disable.
    park_result = i2s_channel_enable(g.tx);
  }
  if (g.mic_rx.may_read()) {
    i2s_chan_info_t rx_info{};
    const esp_err_t rx_info_result = i2s_channel_get_info(g.rx, &rx_info);
    if (rx_info_result != ESP_OK || !g.mic_rx.speaker_transition_preserves_rx(rx_info.is_enabled)) {
      ESP_LOGE(kTag, "speaker_diag RX session lost after TX close (%s enabled=%d)",
               esp_err_to_name(rx_info_result), rx_info.is_enabled);
      return rx_info_result == ESP_OK ? ESP_ERR_INVALID_STATE : rx_info_result;
    }
  }
  ESP_LOGI(kTag, "speaker_diag mute=%d close=%d tx_park=%s", mute_result, close_result, esp_err_to_name(park_result));

  if (!playback.succeeded() || mute_result != ESP_CODEC_DEV_OK || close_result != ESP_CODEC_DEV_OK || park_result != ESP_OK) {
    return write_result != ESP_OK ? write_result : ESP_FAIL;
  }
  return ESP_OK;
}

esp_err_t k151_speaker_playback_begin(uint32_t sample_rate_hz, uint8_t channels) {
  if (!g.speaker || !g.tx || g.speaker_playback_active || sample_rate_hz != kSampleRate || channels != 1) return ESP_ERR_INVALID_ARG;
  // This is intentionally the same factory ownership sequence as the proven
  // tone path, kept open only for the bounded protocol playback session.
  esp_codec_dev_sample_info_t format{};
  format.bits_per_sample = 16;
  format.channel = 1;
  format.sample_rate = kSampleRate;
  const int open_result = esp_codec_dev_open(g.speaker, &format);
  if (open_result != ESP_CODEC_DEV_OK) return ESP_FAIL;
  i2s_chan_info_t tx_info{};
  esp_err_t result = i2s_channel_get_info(g.tx, &tx_info);
  if (result != ESP_OK) { (void)esp_codec_dev_close(g.speaker); return result; }
  if (!tx_info.is_enabled) {
    result = i2s_channel_enable(g.tx);
    if (result != ESP_OK) { (void)esp_codec_dev_close(g.speaker); return result; }
  }
  if (esp_codec_dev_set_out_vol(g.speaker, kSpeakerVolume) != ESP_CODEC_DEV_OK ||
      esp_codec_dev_set_out_mute(g.speaker, false) != ESP_CODEC_DEV_OK) {
    (void)esp_codec_dev_close(g.speaker);
    return ESP_FAIL;
  }
  g.speaker_playback_active = true;
  return ESP_OK;
}

esp_err_t k151_speaker_playback_write(const uint8_t* pcm, size_t byte_count, size_t* bytes_written) {
  if (bytes_written) *bytes_written = 0;
  if (!g.speaker_playback_active || !pcm || byte_count == 0 || byte_count % sizeof(int16_t) != 0) return ESP_ERR_INVALID_ARG;
  // Factory contract: the codec-device opens I2S0 for 24 kHz/S16LE/mono and
  // owns the data interface.  Do not expand or write directly to I2S here.
  const int result = esp_codec_dev_write(g.speaker, const_cast<uint8_t*>(pcm), static_cast<int>(byte_count));
  if (result == ESP_CODEC_DEV_OK && bytes_written) *bytes_written = byte_count;
  return result == ESP_CODEC_DEV_OK ? ESP_OK : ESP_FAIL;
}

esp_err_t k151_speaker_playback_drain() {
  if (!g.speaker_playback_active) return ESP_ERR_INVALID_STATE;
  // This is local codec/I2S DMA drain time, not host-controlled pacing.  It
  // prevents the final bounded write block from being muted during close.
  vTaskDelay(pdMS_TO_TICKS(kSpeakerPlaybackDrainMs));
  return ESP_OK;
}

esp_err_t k151_speaker_playback_end() {
  if (!g.speaker_playback_active) return ESP_ERR_INVALID_STATE;
  const int mute_result = esp_codec_dev_set_out_mute(g.speaker, true);
  const int close_result = esp_codec_dev_close(g.speaker);
  i2s_chan_info_t parked{};
  esp_err_t result = i2s_channel_get_info(g.tx, &parked);
  if (result == ESP_OK && !parked.is_enabled) result = i2s_channel_enable(g.tx);
  g.speaker_playback_active = false;
  if (g.mic_rx.may_read()) {
    i2s_chan_info_t rx{};
    const esp_err_t rx_result = i2s_channel_get_info(g.rx, &rx);
    if (rx_result != ESP_OK || !g.mic_rx.speaker_transition_preserves_rx(rx.is_enabled)) return rx_result == ESP_OK ? ESP_ERR_INVALID_STATE : rx_result;
  }
  return (mute_result == ESP_CODEC_DEV_OK && close_result == ESP_CODEC_DEV_OK) ? result : ESP_FAIL;
}
esp_err_t k151_microphone_capture_level(AudioLevel* level) {
  if (!level || !g.mic) return ESP_ERR_INVALID_STATE;
  *level = {}; level->free_heap_before = esp_get_free_heap_size();
  esp_codec_dev_sample_info_t f{}; f.bits_per_sample=16; f.channel=2; f.channel_mask=ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0)|ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1); f.sample_rate=kSampleRate;
  if (g.mic_rx.needs_open()) {
    const int open = esp_codec_dev_open(g.mic, &f);
    if (open != ESP_CODEC_DEV_OK) {
      g.mic_rx.failed();
      ESP_LOGE(kTag, "mic open=%d", open);
      return ESP_FAIL;
    }
    i2s_chan_info_t rx_info{};
    const esp_err_t rx_info_result = i2s_channel_get_info(g.rx, &rx_info);
    if (rx_info_result != ESP_OK || !rx_info.is_enabled) {
      g.mic_rx.failed();
      ESP_LOGE(kTag, "mic RX did not enter enabled state (%s enabled=%d)",
               esp_err_to_name(rx_info_result), rx_info.is_enabled);
      return rx_info_result == ESP_OK ? ESP_ERR_INVALID_STATE : rx_info_result;
    }
    g.mic_rx.opened_with_enabled_rx();
  }
  if (!g.mic_rx.may_read()) return ESP_ERR_INVALID_STATE;
  i2s_chan_info_t rx_before_read{};
  const esp_err_t rx_before_read_result = i2s_channel_get_info(g.rx, &rx_before_read);
  if (rx_before_read_result != ESP_OK || !g.mic_rx.confirm_enabled(rx_before_read.is_enabled)) {
    ESP_LOGE(kTag, "mic RX session is not enabled before read (%s enabled=%d)",
             esp_err_to_name(rx_before_read_result), rx_before_read.is_enabled);
    return rx_before_read_result == ESP_OK ? ESP_ERR_INVALID_STATE : rx_before_read_result;
  }
  level->rx_lifecycle_enabled = g.mic_rx.may_read();
  level->rx_channel_enabled_before_read = rx_before_read.is_enabled;
  int16_t pcm[960]{}; const int64_t start = esp_timer_get_time();
  const esp_err_t read = esp_codec_dev_read(g.mic, pcm, sizeof(pcm));
  level->duration_ms = static_cast<uint32_t>((esp_timer_get_time()-start)/1000); level->free_heap_after=esp_get_free_heap_size();
  // Deliberately no esp_codec_dev_close here. Closing clears the component
  // manager's in_enable flag and disables RX; its next open then asks the
  // backend to disable that already-disabled channel during format setup.
  // The persistent enabled session is the factory input ownership model.
  if (read != ESP_OK) return read;
  i2s_chan_info_t rx_after_read{};
  const esp_err_t rx_after_read_result = i2s_channel_get_info(g.rx, &rx_after_read);
  if (rx_after_read_result != ESP_OK || !g.mic_rx.confirm_enabled(rx_after_read.is_enabled)) {
    ESP_LOGE(kTag, "mic RX session is not enabled after read (%s enabled=%d)",
             esp_err_to_name(rx_after_read_result), rx_after_read.is_enabled);
    return rx_after_read_result == ESP_OK ? ESP_ERR_INVALID_STATE : rx_after_read_result;
  }
  level->rx_channel_enabled_after_read = rx_after_read.is_enabled;
  microphone_metrics_calculate(pcm,std::size(pcm),level); level->sample_rate_hz=kSampleRate; level->channel_count=2; level->active_channel_mask=3;
  ESP_LOGI(kTag,"mic_diag samples=%u rate=%u bits=16 channels=%u mask=%u peak=%u rms=%ld mean=%ld zero=%u duration_ms=%u heap_before=%u heap_after=%u",level->sample_count,level->sample_rate_hz,level->channel_count,level->active_channel_mask,level->peak,static_cast<long>(level->rms),static_cast<long>(level->mean),level->zero_sample_count,level->duration_ms,level->free_heap_before,level->free_heap_after);
  return ESP_OK;
}
esp_err_t k151_microphone_read_mono_chunk(uint8_t* destination, size_t capacity, AudioLevel* mono_level) {
  if (!destination || capacity < k151_audio_capture_chunk_bytes || !g.mic) return ESP_ERR_INVALID_ARG;
  esp_codec_dev_sample_info_t f{}; f.bits_per_sample=16; f.channel=2; f.channel_mask=ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0)|ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1); f.sample_rate=kSampleRate;
  if (g.mic_rx.needs_open()) {
    if (esp_codec_dev_open(g.mic, &f) != ESP_CODEC_DEV_OK) { g.mic_rx.failed(); return ESP_FAIL; }
    i2s_chan_info_t info{};
    if (i2s_channel_get_info(g.rx, &info) != ESP_OK || !info.is_enabled) { g.mic_rx.failed(); return ESP_ERR_INVALID_STATE; }
    g.mic_rx.opened_with_enabled_rx();
  }
  if (!g.mic_rx.may_read()) return ESP_ERR_INVALID_STATE;
  int16_t interleaved[k151_audio_capture_chunk_bytes]{};
  const esp_err_t read = esp_codec_dev_read(g.mic, interleaved, sizeof(interleaved));
  if (read != ESP_OK) return read;
  auto* mono = reinterpret_cast<int16_t*>(destination);
  for (size_t frame = 0; frame < k151_audio_capture_chunk_bytes / sizeof(int16_t); ++frame) mono[frame] = interleaved[frame * 2];
  if (mono_level) {
    microphone_metrics_calculate(mono, k151_audio_capture_chunk_bytes / sizeof(int16_t), mono_level);
    mono_level->sample_rate_hz = kSampleRate;
    mono_level->channel_count = 1;
    mono_level->active_channel_mask = 1;
    mono_level->rx_lifecycle_enabled = g.mic_rx.may_read();
  }
  return ESP_OK;
}
esp_err_t k151_camera_capture_one(const char* command_id, CameraFrameInfo* frame) {
  if (!frame) return ESP_ERR_INVALID_ARG;
  *frame={}; frame->free_heap_before=esp_get_free_heap_size(); const int64_t command_start=esp_timer_get_time();
  struct RealV4l2 {
    CameraFrameInfo* frame; int fd{-1}; v4l2_capability capability{}; v4l2_format fmt{}, set_format{}; v4l2_requestbuffers req{}; v4l2_buffer buffer{};
    const char* command_id; int64_t command_start; uint32_t selected_pixel_format{};
    void* mapped{MAP_FAILED}; size_t mapped_length{}; bool buffer_queued{}; bool dequeued{}, failure_recorded{}; int64_t dequeue_start_us{};
    void record_failure(int result, int error) {
      if (failure_recorded) return;
      failure_recorded = true; frame->failed_result = result; frame->failed_errno = error; frame->fd_at_failure = fd;
      const char* text = error == 0 ? "" : std::strerror(error);
      std::strncpy(frame->failed_errno_string, text, sizeof(frame->failed_errno_string) - 1);
    }
    void stage(const char* name, bool ok) { std::strncpy(frame->last_stage,name,sizeof(frame->last_stage)-1); ESP_LOGI(kTag,"camera_stage command_id=%s stage=%s result=%d elapsed_ms=%lu",command_id,name,ok,static_cast<unsigned long>((esp_timer_get_time()-command_start)/1000)); }
  } real{frame};
  real.command_id=command_id;
  real.command_start=command_start;
  auto open_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); errno=0; r.fd=open(ESP_VIDEO_DVP_DEVICE_NAME,O_RDWR); r.frame->fd=r.fd; if(r.fd<0)r.record_failure(r.fd,errno); const bool ok=r.fd>=0; r.stage("open",ok); return ok;};
  auto querycap_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); timeval timeout{2,0}; errno=0; const int timeout_rc=ioctl(r.fd,VIDIOC_S_DQBUF_TIMEOUT,&timeout); r.frame->dqbuf_timeout_ms=2000; r.frame->dqbuf_timeout_set=timeout_rc==0; if(timeout_rc!=0){r.record_failure(timeout_rc,errno); r.stage("DQBUF_timeout_set",false); return false;} r.stage("DQBUF_timeout_set",true); r.capability={}; errno=0; const int rc=ioctl(r.fd,VIDIOC_QUERYCAP,&r.capability); if(rc!=0){r.record_failure(rc,errno); r.stage("QUERYCAP",false); return false;} r.frame->querycap_ok=true; std::strncpy(r.frame->driver,reinterpret_cast<const char*>(r.capability.driver),sizeof(r.frame->driver)-1); std::strncpy(r.frame->card,reinterpret_cast<const char*>(r.capability.card),sizeof(r.frame->card)-1); std::strncpy(r.frame->bus_info,reinterpret_cast<const char*>(r.capability.bus_info),sizeof(r.frame->bus_info)-1); r.frame->capabilities=r.capability.capabilities; r.frame->device_caps=r.capability.device_caps; const uint32_t usable=(r.capability.capabilities&V4L2_CAP_DEVICE_CAPS)?r.capability.device_caps:r.capability.capabilities; r.frame->capabilities_ok=(usable&V4L2_CAP_VIDEO_CAPTURE)&&(usable&V4L2_CAP_STREAMING); if(!r.frame->capabilities_ok)r.record_failure(-1,EINVAL); r.stage("QUERYCAP",r.frame->capabilities_ok); return r.frame->capabilities_ok;};
  auto format_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); r.fmt={}; r.fmt.type=V4L2_BUF_TYPE_VIDEO_CAPTURE; errno=0; const int rc=ioctl(r.fd,VIDIOC_G_FMT,&r.fmt); if(rc!=0)r.record_failure(rc,errno); return rc==0;};
  auto enumerate_format_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); r.frame->enumerated_formats[0]='\0'; r.selected_pixel_format=0; v4l2_fmtdesc desc{}; desc.type=V4L2_BUF_TYPE_VIDEO_CAPTURE; for(uint32_t index=0;;++index){desc={}; desc.type=V4L2_BUF_TYPE_VIDEO_CAPTURE; desc.index=index; errno=0; const int rc=ioctl(r.fd,VIDIOC_ENUM_FMT,&desc); if(rc!=0){if(errno==EINVAL)break; r.record_failure(rc,errno); return false;} char fourcc[5]={static_cast<char>(desc.pixelformat&0xff),static_cast<char>((desc.pixelformat>>8)&0xff),static_cast<char>((desc.pixelformat>>16)&0xff),static_cast<char>((desc.pixelformat>>24)&0xff),'\0'}; const size_t used=std::strlen(r.frame->enumerated_formats); if(used<sizeof(r.frame->enumerated_formats)-1) std::snprintf(r.frame->enumerated_formats+used,sizeof(r.frame->enumerated_formats)-used,"%s%lu:%s(%s)",used?";":"",static_cast<unsigned long>(index),fourcc,reinterpret_cast<const char*>(desc.description)); if(desc.pixelformat==V4L2_PIX_FMT_YUV422P)r.selected_pixel_format=desc.pixelformat;} r.frame->enum_fmt_ok=r.selected_pixel_format!=0; if(!r.frame->enum_fmt_ok){r.record_failure(-1,EINVAL); return false;} return true;};
  auto set_format_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); r.set_format={}; r.set_format.type=V4L2_BUF_TYPE_VIDEO_CAPTURE; r.set_format.fmt.pix.width=320; r.set_format.fmt.pix.height=240; r.set_format.fmt.pix.pixelformat=r.selected_pixel_format; r.frame->requested_width=r.set_format.fmt.pix.width; r.frame->requested_height=r.set_format.fmt.pix.height; r.frame->requested_pixel_format=r.set_format.fmt.pix.pixelformat; errno=0; const int rc=ioctl(r.fd,VIDIOC_S_FMT,&r.set_format); r.frame->negotiated_width=r.set_format.fmt.pix.width; r.frame->negotiated_height=r.set_format.fmt.pix.height; r.frame->negotiated_pixel_format=r.set_format.fmt.pix.pixelformat; if(rc!=0){r.record_failure(rc,errno); return false;} r.frame->s_fmt_ok=true; r.fmt=r.set_format; return true;};
  auto request_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); r.req={}; r.req.count=1; r.req.type=r.fmt.type; r.req.memory=V4L2_MEMORY_MMAP; r.frame->requested_buffer_count=r.req.count; errno=0; const int rc=ioctl(r.fd,VIDIOC_REQBUFS,&r.req); r.frame->returned_buffer_count=r.req.count; if(rc!=0 || r.req.count<1)r.record_failure(rc,rc==0?0:errno); return rc==0 && r.req.count>=1;};
  auto query_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); r.buffer={}; r.buffer.type=r.fmt.type; r.buffer.memory=r.req.memory; r.buffer.index=0; errno=0; const int rc=ioctl(r.fd,VIDIOC_QUERYBUF,&r.buffer); r.frame->buffer_index=r.buffer.index; r.frame->buffer_length=r.buffer.length; if(rc!=0 || r.buffer.length==0)r.record_failure(rc,rc==0?0:errno); return rc==0 && r.buffer.length>0;};
  auto map_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); r.mapped_length=r.buffer.length; errno=0; r.mapped=mmap(nullptr,r.mapped_length,PROT_READ|PROT_WRITE,MAP_SHARED,r.fd,r.buffer.m.offset); r.frame->mmap_ok=r.mapped!=MAP_FAILED; if(!r.frame->mmap_ok)r.record_failure(-1,errno); return r.frame->mmap_ok;};
  auto queue_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); const bool requeue=r.frame->acquired; if(r.buffer_queued){r.record_failure(-1,EBUSY); return false;} errno=0; const int rc=ioctl(r.fd,VIDIOC_QBUF,&r.buffer); const bool ok=rc==0; if(requeue)r.frame->requeue_ok=ok; else r.frame->initial_qbuf_ok=ok; if(!ok)r.record_failure(rc,errno); if(ok){r.buffer_queued=true; r.frame->buffer_queued=true; r.dequeued=false; r.frame->released=r.frame->acquired;} return ok;};
  auto stream_on_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); if(!r.buffer_queued){r.record_failure(-1,EINVAL); return false;} errno=0; const int rc=ioctl(r.fd,VIDIOC_STREAMON,&r.fmt.type); const bool ok=rc==0; r.frame->stream_on=ok; r.frame->streaming=ok; if(!ok)r.record_failure(rc,errno); if(ok)r.dequeue_start_us=esp_timer_get_time(); return ok;};
  auto dequeue_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); v4l2_buffer returned{}; returned.type=r.fmt.type; returned.memory=r.req.memory; errno=0; const int rc=ioctl(r.fd,VIDIOC_DQBUF,&returned); const bool ok=rc==0; if(!ok)r.record_failure(rc,errno); if(ok){r.buffer=returned; r.buffer_queued=false; r.frame->buffer_queued=false; r.dequeued=true; r.frame->acquired=true; r.frame->width=r.fmt.fmt.pix.width; r.frame->height=r.fmt.fmt.pix.height; r.frame->pixel_format=r.fmt.fmt.pix.pixelformat; r.frame->bytes=returned.bytesused; r.frame->buffer_index=returned.index; r.frame->buffer_length=returned.length; r.frame->sequence=returned.sequence; r.frame->timestamp_us=static_cast<uint64_t>(returned.timestamp.tv_sec)*1000000ULL+returned.timestamp.tv_usec; r.frame->latency_ms=static_cast<uint32_t>((esp_timer_get_time()-r.dequeue_start_us)/1000);} return ok;};
  auto metadata_valid_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); const bool ok=r.dequeued && (r.buffer.flags&V4L2_BUF_FLAG_DONE) && r.buffer.bytesused>0; if(!ok)r.record_failure(0,0); return ok;};
  auto stream_off_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); errno=0; const int rc=ioctl(r.fd,VIDIOC_STREAMOFF,&r.fmt.type); const bool ok=rc==0; r.frame->stream_off=ok; r.frame->streaming=false; if(!ok)r.record_failure(rc,errno); return ok;};
  auto unmap_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); if(r.mapped==MAP_FAILED){r.record_failure(-1,EINVAL); return false;} errno=0; const int rc=munmap(r.mapped,r.mapped_length); const bool ok=rc==0; r.frame->unmap_ok=ok; if(!ok)r.record_failure(rc,errno); r.mapped=MAP_FAILED; r.mapped_length=0; return ok;};
  auto close_op=[](void* p){auto& r=*static_cast<RealV4l2*>(p); if(r.fd<0){r.record_failure(-1,EBADF); return false;} errno=0; const int rc=close(r.fd); const bool ok=rc==0; r.frame->close_ok=ok; if(!ok)r.record_failure(rc,errno); r.fd=-1; r.frame->fd=r.fd; return ok;};
  CameraCaptureOps ops{&real,open_op,querycap_op,format_op,enumerate_format_op,set_format_op,request_op,query_op,map_op,queue_op,stream_on_op,dequeue_op,metadata_valid_op,stream_off_op,unmap_op,close_op};
  CameraCaptureResult capture_result{};
  const bool ok=camera_capture_once(ops,&capture_result);
  std::strncpy(frame->failed_step, camera_operation_name(capture_result.failed_step), sizeof(frame->failed_step) - 1);
  frame->command_elapsed_ms=static_cast<uint32_t>((esp_timer_get_time()-command_start)/1000);
  frame->free_heap_after=esp_get_free_heap_size();
  ESP_LOGI(kTag,"camera_diag failed_step=%s result=%ld errno=%ld(%s) fd=%ld fd_failure=%ld req=%u ret=%u index=%u length=%u mmap=%d qbuf=%d requeue=%d stream_on=%d stream_off=%d unmap=%d close=%d acquired=%d released=%d bytes=%u heap_before=%u heap_after=%u",frame->failed_step,static_cast<long>(frame->failed_result),static_cast<long>(frame->failed_errno),frame->failed_errno_string,static_cast<long>(frame->fd),static_cast<long>(frame->fd_at_failure),frame->requested_buffer_count,frame->returned_buffer_count,frame->buffer_index,frame->buffer_length,frame->mmap_ok,frame->initial_qbuf_ok,frame->requeue_ok,frame->stream_on,frame->stream_off,frame->unmap_ok,frame->close_ok,frame->acquired,frame->released,frame->bytes,frame->free_heap_before,frame->free_heap_after);
  return ok ? ESP_OK : ESP_FAIL;
}
Telemetry k151_get_telemetry(){return {esp_get_free_heap_size(),heap_caps_get_minimum_free_size(MALLOC_CAP_8BIT),static_cast<uint64_t>(esp_timer_get_time()/1000),g_init_stack_high_water_words,g_runtime_stack_high_water_words};}
void k151_record_init_stack_high_water(uint32_t words) { g_init_stack_high_water_words = words; }
void k151_record_runtime_stack_high_water(uint32_t words) { g_runtime_stack_high_water_words = words; }
} // namespace guest_ai::k151
