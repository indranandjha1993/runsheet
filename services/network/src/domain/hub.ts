import { point, type GeoPoint } from "./geo.js";

const CODE = /^[A-Z0-9-]+$/;
const COUNTRY = /^[A-Z]{2}$/;
const MINUTES_IN_DAY = 24 * 60;

export interface HubInput {
  readonly id: string;
  readonly tenantId: string;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly timeZone: string;
  readonly location: GeoPoint;
  readonly opensMinutesOfDay: number;
  readonly closesMinutesOfDay: number;
}

export interface Hub extends HubInput {
  readonly active: boolean;
}

function knownTimeZone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

function assertCode(code: string): string {
  const normalised = code.trim().toUpperCase();
  if (normalised === "") throw new Error("code is required");
  if (!CODE.test(normalised)) {
    throw new Error("code may contain only letters, digits, and hyphens");
  }
  return normalised;
}

function assertHours(opens: number, closes: number): void {
  if (opens < 0 || closes > MINUTES_IN_DAY) {
    throw new Error("opening hours must fall within the day");
  }
  if (opens >= closes) throw new Error("a hub must open before it closes");
}

export function hub(input: HubInput): Hub {
  const code = assertCode(input.code);
  if (input.name.trim() === "") throw new Error("name is required");
  if (!COUNTRY.test(input.countryCode)) {
    throw new Error("countryCode must be a two-letter code");
  }
  if (!knownTimeZone(input.timeZone)) throw new Error(`unknown time zone: ${input.timeZone}`);
  assertHours(input.opensMinutesOfDay, input.closesMinutesOfDay);

  return {
    ...input,
    code,
    name: input.name.trim(),
    location: point(input.location.latitude, input.location.longitude),
    active: true,
  };
}
