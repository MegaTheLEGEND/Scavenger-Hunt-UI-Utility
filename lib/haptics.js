// Vibration API wrapper — silently no-ops on unsupported devices (iOS, desktop)
const vibe = (pattern) => {
  try { window.navigator?.vibrate?.(pattern); } catch {}
};

export const haptics = {
  // Light tap — opening a card, filter button
  tap:        () => vibe(10),

  // Medium click — closing modal, filter change
  click:      () => vibe(20),

  // Double tap — mark as done
  done:       () => vibe([15, 60, 30]),

  // Undo done
  undone:     () => vibe([30, 40, 10]),

  // Heavy thud — timer start
  timerStart: () => vibe([0, 50, 30, 80]),

  // Descending pulse — timer stop/reset
  timerStop:  () => vibe([60, 40, 30]),

  // Pause — short double
  timerPause: () => vibe([20, 30, 20]),

  // Resume — rising
  timerResume:() => vibe([10, 20, 40]),

  // Alarm — timer expired, long buzz pattern
  timerExpired: () => vibe([100, 50, 100, 50, 200]),

  // Error / delete confirm
  warning:    () => vibe([50, 30, 50]),

  // Success — import/save
  success:    () => vibe([10, 30, 60]),
};
