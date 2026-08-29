#include "fault_injection.hpp"
#include <cstring>
#include <esp_timer.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>
namespace guest_ai::fault { namespace { Snapshot s{Type::None,Phase::Idle}; SemaphoreHandle_t lock(){static SemaphoreHandle_t v=xSemaphoreCreateMutex();return v;} void copy(char*d,const char*s){std::strncpy(d,s?s:"",39);d[39]=0;} }
bool arm(Type t,const char* id){auto l=lock();xSemaphoreTake(l,portMAX_DELAY);bool ok=s.phase==Phase::Idle||s.phase==Phase::AutoCleared;if(ok){s={t,Phase::Armed,(uint64_t)esp_timer_get_time(),0,{},{}};copy(s.armed_by,id);}xSemaphoreGive(l);return ok;}
bool consume(Type t,const char* id){auto l=lock();xSemaphoreTake(l,portMAX_DELAY);bool ok=s.phase==Phase::Armed&&s.type==t;if(ok){s.phase=Phase::Triggered;s.triggered_at=esp_timer_get_time();copy(s.triggered_by,id);s.type=Type::None;s.phase=Phase::AutoCleared;}xSemaphoreGive(l);return ok;}
Snapshot snapshot(){auto l=lock();xSemaphoreTake(l,portMAX_DELAY);auto v=s;xSemaphoreGive(l);return v;}}
extern "C" bool feedx_fault_consume_camera_dqbuf_timeout_once(void) { return guest_ai::fault::consume(guest_ai::fault::Type::CameraDqbufTimeoutOnce, "camera_dqbuf"); }
extern "C" bool feedx_fault_consume_usb_tx_zero_progress_once(const char* id) { return guest_ai::fault::consume(guest_ai::fault::Type::UsbTxZeroProgressOnce, id); }
extern "C" bool feedx_fault_consume_usb_tx_partial_once(const char* id) { return guest_ai::fault::consume(guest_ai::fault::Type::UsbTxPartialOnce, id); }
