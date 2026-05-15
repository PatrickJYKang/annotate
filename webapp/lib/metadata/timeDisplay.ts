function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

/**
 * Raw video time -> `mm:ss.mmm` or `h:mm:ss.mmm` if the timestamp is at least one hour.
 */
export function formatRawTime(ms: number): string {
  const clamped = Math.max(0, Math.floor(ms));
  let r = clamped;
  const hh = Math.floor(r / 3600000); r %= 3600000;
  const mm = Math.floor(r / 60000); r %= 60000;
  const ss = Math.floor(r / 1000);
  const mmm = r % 1000;
  return hh > 0
    ? `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(mmm)}`
    : `${mm}:${pad2(ss)}.${pad3(mmm)}`;
}
