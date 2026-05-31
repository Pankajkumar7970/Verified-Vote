import crypto from 'crypto';

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRefCode(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    code += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  }
  return code;
}
