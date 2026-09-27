import release from './prepared.json' with { type: 'json' };

const cache = new Map();
const hex = bytes => [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');

export function requiredFontShards(manifest) {
  // Include renderer-owned punctuation and all Latin document labels as well as
  // arbitrary identity/line text. No fixed language subset or missing-glyph fallback.
  const characters = JSON.stringify(manifest) + Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join('') + '·—';
  const blocks = new Set();
  for (const character of characters) {
    const cp = character.codePointAt(0);
    const block = Math.floor(cp / 256);
    if (!release.shards[block]?.codepoints.includes(cp)) throw new Error('Payslip character is not supported by the release font.');
    blocks.add(block);
  }
  return [...blocks].sort((a, b) => a - b).map(block => release.shards[block]);
}

export async function loadPayslipFonts(manifest, download) {
  return Promise.all(requiredFontShards(manifest).map(async shard => {
    if (cache.has(shard.sha256)) return cache.get(shard.sha256);
    const blob = await download(`prepared-v1/${shard.sha256}.ttf.gz`);
    const bytes = new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    if (bytes.length !== shard.size || hex(await crypto.subtle.digest('SHA-256', bytes)) !== shard.sha256) throw new Error('Font evidence changed.');
    cache.set(shard.sha256, bytes);
    return bytes;
  }));
}
