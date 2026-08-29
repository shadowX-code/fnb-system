#pragma once
#include "fault_injection.hpp"
namespace guest_ai::fault { class StateMachine { public: Snapshot value{}; bool arm(Type t){if(value.phase!=Phase::Idle&&value.phase!=Phase::AutoCleared)return false;value.type=t;value.phase=Phase::Armed;return true;} bool consume(Type t){if(value.phase!=Phase::Armed||value.type!=t)return false;value.phase=Phase::Triggered;value.type=Type::None;value.phase=Phase::AutoCleared;return true;} }; }
