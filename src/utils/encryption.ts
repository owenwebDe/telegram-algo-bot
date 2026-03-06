import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV recommended for GCM
const TAG_BYTES = 16;  // 128-bit auth tag

/**
 * Parse the encryption key once at module load time.
 * Expects a 64-character lowercase hex string (32 bytes).
 */
function loadKey(): Buffer {
  const hex = env.encryptionKey;
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      'MT5_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return Buffer.from(hex, 'hex');
}

const KEY = loadKey();

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns a single base64 string: iv(12B) || tag(16B) || ciphertext
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Pack: [iv][tag][ciphertext]
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypt a base64 blob produced by `encrypt`.
 */
export function decrypt(blob: string): string {
  const combined = Buffer.from(blob, 'base64');
  if (combined.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Invalid encrypted payload: too short');
  }
  const iv = combined.subarray(0, IV_BYTES);
  const tag = combined.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = combined.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
