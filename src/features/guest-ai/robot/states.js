export const ROBOT_STATES = Object.freeze(["OFFLINE", "BOOTING", "IDLE", "ATTENTION", "LISTENING", "THINKING", "SPEAKING", "ERROR"]);

export function isRobotState(value) {
  return ROBOT_STATES.includes(value);
}
