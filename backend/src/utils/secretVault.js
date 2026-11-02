/**
 * secretVault: storage for recoverable secrets (such as company mailbox passwords).
 * Why encryption, not a hash: system login passwords are hashed because we only verify them. Here it is a Hostinger mailbox password that IT must read back to give to an employee or configure a mail client, so bcrypt is useless and plaintext unacceptable. The right middle ground is symmetric encryption with a key outside the database.
 * AES-256-GCM gives confidentiality and tamper detection: if someone edits the row in Mongo, decryption fails instead of returning garbage.
 * The key comes from `EMAIL_VAULT_KEY` (32 bytes, hex or base64). If missing, saving is rejected rather than storing plaintext; failing silently here would leak passwords. Generate a key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

let cachedKey;
function getKey() {
  if (cachedKey !== undefined) return cachedKey;
  const raw = (process.env.EMAIL_VAULT_KEY || '').trim();
  if (!raw) { cachedKey = null; return cachedKey; }
  let buf;
  if (/^[0-9a-f]{64}$/i.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    console.error('[secretVault] EMAIL_VAULT_KEY must decode to 32 bytes — secrets will NOT be stored.');
    cachedKey = null;
    return cachedKey;
  }
  cachedKey = buf;
  return cachedKey;
}

/** Whether the vault is ready; the UI asks so it can tell the user instead of losing their input. */
const isReady = () => !!getKey();

/** Encrypt text. Returns one base64 string `v1:iv:tag:ciphertext` stored in a single field, so the schema need not change if the algorithm changes later. */
function encrypt(plain) {
  const key = getKey();
  if (!key) {
    const e = new Error('خزنة كلمات المرور غير مهيأة (EMAIL_VAULT_KEY) — لا يمكن حفظ كلمة المرور');
    e.status = 503;
    e.code = 'VAULT_NOT_CONFIGURED';
    throw e;
  }
  const text = String(plain ?? '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);                 // 96-bit IV, the size recommended for GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/** Decrypt. Returns null if there is no value, and throws if the key is wrong or the data was tampered with, which is far better than returning random characters as a password. */
function decrypt(stored) {
  if (!stored) return '';
  const key = getKey();
  if (!key) {
    const e = new Error('خزنة كلمات المرور غير مهيأة (EMAIL_VAULT_KEY)');
    e.status = 503;
    e.code = 'VAULT_NOT_CONFIGURED';
    throw e;
  }
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    const e = new Error('صيغة كلمة المرور المخزّنة غير معروفة');
    e.status = 500;
    throw e;
  }
  const [, iv, tag, data] = parts;
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isReady };
