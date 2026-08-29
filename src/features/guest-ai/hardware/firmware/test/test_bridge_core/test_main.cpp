#include <unity.h>
#include "BridgeCore.hpp"
using namespace guest_ai::bridge;
void test_gaze_bounds_are_strict() { TEST_ASSERT_TRUE(isSafeGaze(0, 45)); TEST_ASSERT_TRUE(isSafeGaze(90, 45)); TEST_ASSERT_FALSE(isSafeGaze(91, 45)); TEST_ASSERT_FALSE(isSafeGaze(0, 4)); TEST_ASSERT_FALSE(isSafeGaze(0, 86)); }
void test_wire_command_validation() { TEST_ASSERT_EQUAL(static_cast<int>(CommandType::SetGaze), static_cast<int>(commandFromWire("set_gaze"))); TEST_ASSERT_EQUAL(static_cast<int>(CommandType::PlayAudio), static_cast<int>(commandFromWire("play_audio"))); TEST_ASSERT_EQUAL(static_cast<int>(CommandType::Unsupported), static_cast<int>(commandFromWire("unknown"))); }
void test_state_and_expression_validation() { TEST_ASSERT_EQUAL_STRING("SPEAKING", robotStateToWire(robotStateFromWire("SPEAKING"))); TEST_ASSERT_EQUAL_STRING("ERROR", robotStateToWire(robotStateFromWire("NOPE"))); TEST_ASSERT_TRUE(isAllowedExpression("blink")); TEST_ASSERT_FALSE(isAllowedExpression("unknown")); }
int main(int, char**) { UNITY_BEGIN(); RUN_TEST(test_gaze_bounds_are_strict); RUN_TEST(test_wire_command_validation); RUN_TEST(test_state_and_expression_validation); return UNITY_END(); }
