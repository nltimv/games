// The company log: what happened and when. The "while you were away" card
// shows the entries since the last visit.

const MAX_ENTRIES = 200;

let muted = 0;

/** Runs `fn` with nothing going into the log: what a fleet does out of contact (see trackMission). */
export function quietly(fn) {
  muted += 1;
  try {
    return fn();
  } finally {
    muted -= 1;
  }
}

/** `amount` (optional) is the credits the event brought in or cost. */
export function addLog(state, at, text, kind = 'info', amount) {
  if (muted) return;
  state.log.push(amount == null ? { at, text, kind } : { at, text, kind, amount });
  if (state.log.length > MAX_ENTRIES) state.log.splice(0, state.log.length - MAX_ENTRIES);
}

export function logSince(state, since) {
  return state.log.filter((entry) => entry.at > since);
}
