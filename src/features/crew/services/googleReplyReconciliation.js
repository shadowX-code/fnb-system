// Only stale successful reads are retried. Provider failures/429s stay explicit; never retry a write.
export async function readReconciledReply(read, isCurrent = () => true, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const delays = [0, 2000, 6000, 12000];
  let detail;
  for (const delay of delays) {
    if (delay) await wait(delay);
    if (!isCurrent()) return null;
    detail = await read();
    if (!isCurrent()) return null;
    if (!detail.reply_sync_pending) break;
  }
  return detail;
}
