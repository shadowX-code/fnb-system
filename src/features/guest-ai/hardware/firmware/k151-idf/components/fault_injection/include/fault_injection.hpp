#pragma once
#include <cstdint>
namespace guest_ai::fault {
enum class Type : uint8_t { None, CameraDqbufTimeoutOnce, UsbTxZeroProgressOnce, UsbTxPartialOnce };
enum class Phase : uint8_t { Idle, Armed, Triggered, AutoCleared };
struct Snapshot { Type type; Phase phase; uint64_t armed_at; uint64_t triggered_at; char armed_by[40]; char triggered_by[40]; };
bool arm(Type type, const char* command_id); bool consume(Type expected, const char* command_id); Snapshot snapshot();
}
extern "C" bool feedx_fault_consume_camera_dqbuf_timeout_once(void);
