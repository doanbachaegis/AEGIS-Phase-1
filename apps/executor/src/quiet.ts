/**
 * Warning hygiene for the CLI. Imported FIRST, for side effects only.
 *
 * `node:sqlite` prints an ExperimentalWarning the moment it is imported. That
 * is a stability-of-API notice about the module, not a durability caveat about
 * the journal — but a settlement transcript is evidence a reviewer reads, and an
 * unexplained warning in the middle of one invites exactly the wrong conclusion.
 *
 * It lives in its own module because ES module imports are evaluated in source
 * order: the listener has to be installed before anything that reaches
 * `node:sqlite` is imported, and only a separate first import can guarantee that.
 * Every other warning is still printed.
 */
process.removeAllListeners("warning");
process.on("warning", (w: Error) => {
  if (w.name === "ExperimentalWarning" && /SQLite/i.test(w.message)) return;
  console.warn(`${w.name}: ${w.message}`);
});
