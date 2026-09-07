// The parcel identifier every service reads off a label. One format, one check rule.
const PREFIX = "RS";
const SERIAL_DIGITS = 9;
const MAX_SERIAL = 10 ** SERIAL_DIGITS - 1;

// Damm's quasigroup. It catches every single-digit error and every transposition of adjacent
// digits, which are the two ways a barcode goes wrong: a bad scan and a hand-typed number.
const DAMM = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

function fold(digits: string): number {
  let interim = 0;
  for (const character of digits) {
    interim = DAMM[interim]?.[Number(character)] ?? 0;
  }
  return interim;
}

export function barcodeFor(serial: number): string {
  if (!Number.isInteger(serial) || serial <= 0) {
    throw new Error("serial must be positive");
  }
  if (serial > MAX_SERIAL) {
    throw new Error("serial is too large for a barcode");
  }

  const body = String(serial).padStart(SERIAL_DIGITS, "0");
  return `${PREFIX}${body}${String(fold(body))}`;
}

export function isValidBarcode(value: string): boolean {
  if (!new RegExp(`^${PREFIX}[0-9]{${String(SERIAL_DIGITS + 1)}}$`).test(value)) return false;
  return fold(value.slice(PREFIX.length)) === 0;
}
