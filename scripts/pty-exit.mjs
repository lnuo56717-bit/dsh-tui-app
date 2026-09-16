/**
 * Windows ConPTY via node-pty sometimes omits a numeric code after a clean
 * quit. Treat a missing code as success; keep any actual nonzero failure.
 */
export function ptyExitOk(exitCode) {
  return exitCode === 0 || exitCode == null
}
