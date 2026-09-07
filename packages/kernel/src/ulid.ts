const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

function encodeTime(millis: number): string {
  let out = "";
  let rest = millis;
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = ALPHABET.charAt(rest % 32) + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

// The web crypto interface is the one thing every runtime this code reaches shares: Node, a
// browser tab, and a handset's web view. Nothing Node-only may live in the kernel.
function encodeRandom(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(RANDOM_CHARS));
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET.charAt(byte % 32);
  }
  return out;
}

export function ulid(at: Date = new Date()): string {
  return encodeTime(at.getTime()) + encodeRandom();
}
