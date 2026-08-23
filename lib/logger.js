// Timestamped, de-duplicating logger.
//
// The bridge polls constantly, so logging every poll would bury anything
// that actually matters. `log()` writes unconditionally (use it for events),
// while `logState()` only writes when the message differs from the last one
// it was given -- so a console sitting in one state stays silent.
function stamp() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(message) {
  console.log(`[${stamp()}] ${message}`);
}

function logError(message) {
  console.error(`[${stamp()}] ${message}`);
}

let lastStateMessage = null;

function logState(message) {
  if (message === lastStateMessage) return;
  lastStateMessage = message;
  log(message);
}

// Forces the next logState() to print even if the message is unchanged.
function resetStateLog() {
  lastStateMessage = null;
}

module.exports = { log, logError, logState, resetStateLog };
