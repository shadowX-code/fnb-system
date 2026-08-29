#pragma once
#include <stdbool.h>
#ifdef __cplusplus
extern "C" {
#endif
bool feedx_fault_consume_camera_dqbuf_timeout_once(void);
bool feedx_fault_consume_usb_tx_zero_progress_once(const char *command_id);
bool feedx_fault_consume_usb_tx_partial_once(const char *command_id);
#ifdef __cplusplus
}
#endif
