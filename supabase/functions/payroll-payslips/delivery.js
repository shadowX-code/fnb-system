const encoder = new TextEncoder();
const binding = encoder.encode('feedx:payroll-payslip-delivery:v1');
export const deliverySeconds = 60;

export function payslipFilename(manifest, draft) {
  const period = String(manifest.period_start ?? '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('Payslip period unavailable.');
  const name = String(manifest.identity?.employee_name ?? '').toWellFormed().normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]+/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '');
  let bounded = '';
  for (const character of name) {
    if (encoder.encode(bounded + character).length > 200) break;
    bounded += character;
  }
  return `Payslip_${period}_${bounded.trimEnd() || 'Employee'}${draft ? '_DRAFT' : ''}.pdf`;
}

export function pdfDisposition(filename, download = false) {
  const ascii = filename.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9._ -]/g, '_');
  const utf8 = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

async function keyFor(secret) {
  if (!secret) throw new Error('Payslip delivery unavailable.');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`feedx:payroll-payslip-delivery:v1:${secret}`));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealDelivery(payload, secret, now = Date.now()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify({ ...payload, expires: now + deliverySeconds * 1000 }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: binding }, await keyFor(secret), plain));
  return btoa(String.fromCharCode(...iv, ...ciphertext)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function openDelivery(ticket, secret, now = Date.now()) {
  if (!ticket || ticket.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(ticket)) return null;
  try {
    const bytes = Uint8Array.from(atob(ticket.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12), additionalData: binding }, await keyFor(secret), bytes.subarray(12));
    const payload = JSON.parse(new TextDecoder().decode(plain));
    return payload.expires > now ? payload : null;
  } catch { return null; }
}
