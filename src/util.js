import crypto from 'crypto';

export function hashSync(plain) {
  return crypto.createHash('sha256').update(String(plain)).digest('hex');
}
export function compareSync(plain, hash) {
  return hashSync(plain) === hash;
}
