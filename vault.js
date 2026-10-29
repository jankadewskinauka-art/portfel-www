// Szyfrowanie sejfu w przeglądarce (WebCrypto). Format zgodny z engine/crypto_vault.py:
// PBKDF2-SHA256 (600 000 iteracji) -> AES-256-GCM, dane spakowane gzipem.
// Klucz jest nieeksportowalny: nawet skrypt na tej stronie nie może go odczytać jako bajtów.

const te = new TextEncoder();
const td = new TextDecoder();

export const META_FORMAT = 'portfel-meta-1';
export const VAULT_FORMAT = 'portfel-vault-1';

export function b64e(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64d(text) {
  const s = atob(text);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

export function normalizePassword(p) {
  return String(p || '').normalize('NFC').trim();
}

export function newMeta(iterations = 600000) {
  return { f: META_FORMAT, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64e(crypto.getRandomValues(new Uint8Array(16))) };
}

export async function deriveKey(password, meta) {
  if (!meta || meta.f !== META_FORMAT || meta.kdf !== 'PBKDF2-SHA256') throw new Error('meta');
  const base = await crypto.subtle.importKey('raw', te.encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64d(meta.salt), iterations: Number(meta.iter) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function pipeBytes(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encryptObj(key, obj, aad) {
  const packed = await pipeBytes(te.encode(JSON.stringify(obj)), new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, packed);
  return { f: VAULT_FORMAT, iv: b64e(iv), ct: b64e(new Uint8Array(ct)) };
}

// Rzuca wyjątek przy złym haśle albo podmienionym pliku.
export async function decryptObj(key, env, aad) {
  if (!env || env.f !== VAULT_FORMAT) throw new Error('format');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64d(env.iv), additionalData: te.encode(aad) },
    key,
    b64d(env.ct),
  );
  const raw = await pipeBytes(new Uint8Array(pt), new DecompressionStream('gzip'));
  return JSON.parse(td.decode(raw));
}
