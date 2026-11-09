// Web Push sem biblioteca: conteúdo cifrado em aes128gcm (RFC 8291) e identificação VAPID (RFC 8292), só com WebCrypto.
// Não usa nada específico do Deno: roda igual no Node, onde é testado contra o exemplo do próprio RFC 8291.
const enc = new TextEncoder();

export const b64u = (b: Uint8Array | ArrayBuffer): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string): Uint8Array => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0));
};
const cat = (...a: Uint8Array[]): Uint8Array => {
  const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0;
  for (const x of a) { o.set(x, i); i += x.length; }
  return o;
};
const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8));
};
const P256 = { name: 'ECDH', namedCurve: 'P-256' };

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { pub: string; priv: string; subject: string };

// Corpo da requisição: salt(16) | tamanho do bloco (4096) | tamanho da chave (65) | chave pública do servidor | dados cifrados.
// `fixed` (chave temporária e salt fixos) existe só para o teste com o exemplo do RFC.
export async function encryptPayload(sub: { p256dh: string; auth: string }, payload: Uint8Array,
  fixed?: { asPrivate: JsonWebKey; asPublic: Uint8Array; salt: Uint8Array }): Promise<Uint8Array> {
  if (payload.length > 3800) throw new Error('Mensagem grande demais para um aviso');
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  let asPub: Uint8Array, asPriv: CryptoKey;
  if (fixed) {
    asPub = fixed.asPublic;
    asPriv = await crypto.subtle.importKey('jwk', fixed.asPrivate, P256, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey(P256, true, ['deriveBits']) as CryptoKeyPair;
    asPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    asPriv = kp.privateKey;
  }
  const uaKey = await crypto.subtle.importKey('raw', ua, P256, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  const ikm = await hkdf(auth, ecdh, cat(enc.encode('WebPush: info\0'), ua, asPub), 32);
  const salt = fixed ? fixed.salt : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(payload, new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([asPub.length]), asPub, ct);
}

export async function vapidHeader(endpoint: string, k: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: k.subject })));
  const p = unb64u(k.pub);
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d: k.priv }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${k.pub}`;
}

// Envia um aviso. `gone` = a inscrição não existe mais (o app foi desinstalado ou o aviso foi desligado): pode apagar.
export async function sendWebPush(sub: PushSub, payload: unknown, keys: VapidKeys, opt: { ttl?: number; urgency?: string } = {}) {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(payload)));
  const r = await fetch(sub.endpoint, {
    method: 'POST', body, signal: AbortSignal.timeout(10_000),
    headers: {
      'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: String(opt.ttl ?? 3600), urgency: opt.urgency ?? 'high',
      authorization: await vapidHeader(sub.endpoint, keys),
    },
  });
  const text = r.ok ? '' : (await r.text().catch(() => '')).slice(0, 200);
  return { status: r.status, ok: r.ok, gone: r.status === 404 || r.status === 410, text };
}
