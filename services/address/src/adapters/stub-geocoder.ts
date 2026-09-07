import type { Geocoder } from "../application/ports.js";
import type { Coordinates } from "../domain/address.js";

const CENTRES: Record<string, Coordinates> = {
  IN: { latitude: 20.5937, longitude: 78.9629 },
  AE: { latitude: 24.4539, longitude: 54.3773 },
};

// Used when no geocoding provider is configured, so a fresh clone runs without an account
// anywhere. It places an address at the centre of its country with low confidence, which is
// honest: it is a guess, and the confidence says so.
export function stubGeocoder(): Geocoder {
  return {
    locate: (_raw, countryCode) => {
      const centre = CENTRES[countryCode];
      return Promise.resolve(centre === undefined ? undefined : { ...centre, confidence: 0.1 });
    },
  };
}
