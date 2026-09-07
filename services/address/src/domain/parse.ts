import { DomainError } from "./errors.js";

export interface ParsedAddress {
  readonly raw: string;
  readonly countryCode: string;
  readonly postcode?: string;
  readonly makani?: string;
  readonly landmark?: string;
  readonly unit?: string;
  readonly completeness: number;
}

// People here navigate by landmark, not by street number. A courier told "near the Sai Temple"
// finds the door; one given only a house number often does not.
const LANDMARK = /\b(?:near|opposite|opp\.?|behind|beside|next to|beh\.?)\s+([^,]+)/i;
const UNIT = /(?:\bflat\s*|\bhouse\s*(?:no\.?)?\s*|\bno\.?\s*|#\s*)([0-9]+[A-Za-z]?)\b/i;
const INDIAN_POSTCODE = /(?:^|[\s,])([1-9][0-9]{5})(?:[\s,]|$)/;
const MAKANI = /\bmakani\s+([0-9]{5}\s?[0-9]{5})\b/i;

// Drops the fields the parser could not find, so an address never carries an empty value that
// later reads as "we looked and it is blank".
function present(
  fields: Record<string, string | undefined>,
): Omit<ParsedAddress, "completeness"> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) out[name] = value;
  }
  return out as unknown as Omit<ParsedAddress, "completeness">;
}

function scoreOf(parsed: Omit<ParsedAddress, "completeness">): number {
  const signals = [
    parsed.postcode !== undefined || parsed.makani !== undefined,
    parsed.landmark !== undefined,
    parsed.unit !== undefined,
    parsed.raw.split(",").length >= 3,
  ];
  return signals.filter(Boolean).length / signals.length;
}

export function parseAddress(raw: string, countryCode: string): ParsedAddress {
  if (raw.trim() === "") throw new DomainError("invalid_input", "an address needs some text");

  const landmark = LANDMARK.exec(raw)?.[1]?.trim();
  const unitMatch = UNIT.exec(raw);
  const unit = unitMatch?.[1];

  // A flat number can look exactly like a postcode. Take the unit out of the text before
  // looking for one, so "Flat 100200" is a flat and not a postal code.
  const withoutUnit = unitMatch === null ? raw : raw.replace(unitMatch[0], " ");
  const postcode = countryCode === "IN" ? INDIAN_POSTCODE.exec(withoutUnit)?.[1] : undefined;
  const makani = countryCode === "AE" ? MAKANI.exec(withoutUnit)?.[1] : undefined;

  const parsed = present({ raw, countryCode, postcode, makani, landmark, unit });

  return { ...parsed, completeness: scoreOf(parsed) };
}
