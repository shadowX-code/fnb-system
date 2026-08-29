#include <driver/usb_serial_jtag.h>
#include <esp_err.h>
#include <esp_log.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include <device_protocol.hpp>
#include <k151_board.hpp>
#include <usb_rx_pump.hpp>
#include <usb_rx_scheduling.hpp>

namespace {

constexpr const char* kTag = "guest_ai_startup";
constexpr uint32_t kInitTaskStackBytes = 12 * 1024;
constexpr uint32_t kRuntimeTaskStackBytes = 6 * 1024;
constexpr uint32_t kUsbRxDriverBufferBytes = 6144;

// Transport owns a 2 KiB frame buffer. BSS storage keeps it out of every task stack.
guest_ai::protocol::Transport g_transport;
uint8_t g_runtime_read_buffer[256];
guest_ai::protocol::UsbRxPump g_usb_rx;

int usb_rx_read(void*, uint8_t* buffer, size_t capacity) {
  // A bounded driver wait wakes immediately when data arrives, but blocks the
  // no-data path for one scheduler tick instead of spinning on zero-byte reads.
  return usb_serial_jtag_read_bytes(buffer, static_cast<uint32_t>(capacity),
                                    pdMS_TO_TICKS(guest_ai::protocol::UsbRxScheduling::kReadTimeoutMs));
}

void usb_rx_ingest(void*, const uint8_t* bytes, size_t count) {
  g_transport.ingest(bytes, count);
}

void usb_rx_reset(void*) {
  g_transport.reset();
}

void log_rx_preview(const uint8_t* bytes, size_t count) {
  char preview[17]{};
  const size_t preview_count = count < sizeof(preview) - 1 ? count : sizeof(preview) - 1;
  bool has_newline = false;
  for (size_t index = 0; index < preview_count; ++index) {
    const uint8_t value = bytes[index];
    has_newline = has_newline || value == '\n';
    preview[index] = value >= 0x20 && value <= 0x7e ? static_cast<char>(value) : '.';
  }
  ESP_LOGI(kTag, "usb_rx bytes=%u newline=%d preview=%s", static_cast<unsigned>(count),
           has_newline, preview);
}

void runtime_task(void*) {
  ESP_LOGI(kTag, "runtime task started (stack=%u bytes)", kRuntimeTaskStackBytes);
  uint32_t last_heartbeat_ms = 0;
  uint32_t last_rx_diagnostics_ms = 0;
  uint32_t last_rx_calls = 0;
  uint32_t last_rx_zero_reads = 0;
  bool host_connected = false;
  guest_ai::protocol::UsbRxOps rx_ops{nullptr, usb_rx_read, usb_rx_ingest, usb_rx_reset};
  while (true) {
    const bool connected_now = usb_serial_jtag_is_connected();
    if (connected_now && !host_connected) {
      ESP_LOGI(kTag, "init stage: usb_protocol PASS; host connected");
      g_transport.send_startup_snapshot();
      host_connected = true;
    } else if (!connected_now && host_connected) {
      ESP_LOGI(kTag, "USB host disconnected; startup snapshot will be resent on reconnect");
      host_connected = false;
    }

    bool received = false;
    for (uint32_t read = 0; read < guest_ai::protocol::UsbRxScheduling::kMaxBurstReads; ++read) {
      const bool one_read = g_usb_rx.poll(rx_ops, connected_now, g_runtime_read_buffer, sizeof(g_runtime_read_buffer));
      if (one_read) {
        received = true;
        const auto& diagnostics = g_usb_rx.diagnostics();
        log_rx_preview(g_runtime_read_buffer, static_cast<size_t>(diagnostics.last_read_result));
        continue;
      }
      break;
    }
    if (!received && g_usb_rx.diagnostics().last_read_result < 0) {
      ESP_LOGW(kTag, "usb_rx read_error=%d", g_usb_rx.diagnostics().last_read_result);
    }

    const uint32_t now_ms = xTaskGetTickCount() * portTICK_PERIOD_MS;
    if (now_ms - last_rx_diagnostics_ms >= 1000) {
      const auto& diagnostics = g_usb_rx.diagnostics();
      const uint32_t calls_per_second = diagnostics.read_calls - last_rx_calls;
      const uint32_t zero_reads_per_second = diagnostics.zero_byte_reads - last_rx_zero_reads;
      ESP_LOGI(kTag, "usb_rx calls=%u zero=%u poll_hz=%u zero_hz=%u errors=%u bytes=%u newlines=%u reconnects=%u disconnects=%u last=%d delay_ticks=%u",
               static_cast<unsigned>(diagnostics.read_calls), static_cast<unsigned>(diagnostics.zero_byte_reads),
               static_cast<unsigned>(calls_per_second), static_cast<unsigned>(zero_reads_per_second),
               static_cast<unsigned>(diagnostics.read_errors), static_cast<unsigned>(diagnostics.bytes_received),
               static_cast<unsigned>(diagnostics.newline_count), static_cast<unsigned>(diagnostics.reconnects),
               static_cast<unsigned>(diagnostics.disconnects), diagnostics.last_read_result,
               static_cast<unsigned>(pdMS_TO_TICKS(guest_ai::protocol::UsbRxScheduling::kPostPollDelayMs)));
      last_rx_calls = diagnostics.read_calls;
      last_rx_zero_reads = diagnostics.zero_byte_reads;
      last_rx_diagnostics_ms = now_ms;
    }
    if (host_connected && now_ms - last_heartbeat_ms >= 5000) {
      guest_ai::k151::k151_record_runtime_stack_high_water(uxTaskGetStackHighWaterMark(nullptr));
      g_transport.heartbeat();
      last_heartbeat_ms = now_ms;
    }
    // This yield is intentional even after a successful read: dispatch already
    // happened above, and one tick prevents sustained host traffic from starving
    // IDLE0 or driver tasks.
    vTaskDelay(pdMS_TO_TICKS(guest_ai::protocol::UsbRxScheduling::kPostPollDelayMs));
  }
}

void k151_init_task(void*) {
  ESP_LOGI(kTag, "init task started (stack=%u bytes)", kInitTaskStackBytes);
  ESP_LOGI(kTag, "init stage: board");
  const esp_err_t board_result = guest_ai::k151::k151_board_init();
  guest_ai::k151::k151_record_init_stack_high_water(uxTaskGetStackHighWaterMark(nullptr));
  if (board_result != ESP_OK) {
    ESP_LOGW(kTag, "board initialization incomplete: %s; continuing as a device gateway", esp_err_to_name(board_result));
  }

  const BaseType_t runtime_created = xTaskCreate(runtime_task, "guest_ai_runtime", kRuntimeTaskStackBytes,
                                                  nullptr, tskIDLE_PRIORITY + 1, nullptr);
  if (runtime_created != pdPASS) {
    ESP_LOGE(kTag, "runtime task creation failed");
  }
  guest_ai::k151::k151_record_init_stack_high_water(uxTaskGetStackHighWaterMark(nullptr));
  vTaskDelete(nullptr);
}

}  // namespace

extern "C" void app_main(void) {
  usb_serial_jtag_driver_config_t usb_config{};
  usb_config.tx_buffer_size = 2048;
  // Full-turn playback uploads remain canonical JSON-lines frames below the
  // independent 2 KiB framer cap. The protocol pump drains them into a
  // bounded device prebuffer before speaker playback begins.
  usb_config.rx_buffer_size = kUsbRxDriverBufferBytes;
  const esp_err_t usb_result = usb_serial_jtag_driver_install(&usb_config);
  if (usb_result != ESP_OK) {
    ESP_LOGE(kTag, "USB CDC initialization failed: %s", esp_err_to_name(usb_result));
    return;
  }

  // After the USB driver exists, reserve the application wire for protocol
  // JSON-lines. Early ROM/boot output remains possible, but runtime ESP_LOG
  // must not splice bytes into canonical frames.
  guest_ai::protocol::Transport::enable_protocol_exclusive_wire();

  const BaseType_t init_created = xTaskCreate(k151_init_task, "k151_init", kInitTaskStackBytes,
                                               nullptr, tskIDLE_PRIORITY + 2, nullptr);
  if (init_created != pdPASS) {
    ESP_LOGE(kTag, "init task creation failed");
  }
}
