import { randomBytes } from "node:crypto";

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

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_CHARS);
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET.charAt(byte % 32);
  }
  return out;
}

export function ulid(at: Date = new Date()): string {
  return encodeTime(at.getTime()) + encodeRandom();
}
