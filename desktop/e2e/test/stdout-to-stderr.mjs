// Preload for `npm test`: console.log/info/debug go to stderr, so a test's text never lands inside the node:test runner's result channel (stdout).
// Why (1 Nov 2026, a8; runs 41260793140, 41246498347 "Unable to deserialize cloned data" in quality-split): the runner reads a test file's stdout as frames
// (2-byte header + size) and checks for text only once per read. A line that begins with a multi-byte character (✓ ✗ ⚠: byte 3 is >= 0x80, so the size
// reads negative in int32) and arrives in the same read right after a frame is parsed as a frame and throws. lib/runner.mjs prints exactly such lines;
// whether the pipe hands them over together is timing, hence the flake. stderr is read line by line and never parsed as frames.
for (const name of ['log', 'info', 'debug']) console[name] = (...args) => console.error(...args);
