// The company log: what happened and when. The "while you were away" card
// shows the entries since the last visit.

const MAX_ENTRIES = 200;

/** `amount` (optional) is the credits the event brought in or cost. */
export function addLog(state, at, text, kind = 'info', amount) {
  state.log.push(amount == null ? { at, text, kind } : { at, text, kind, amount });
  if (state.log.length > MAX_ENTRIES) state.log.splice(0, state.log.length - MAX_ENTRIES);
}

export function logSince(state, since) {
  return state.log.filter((entry) => entry.at > since);
}
