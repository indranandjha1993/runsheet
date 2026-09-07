import { DomainError } from "./errors.js";

export const LOCALES = ["en-IN", "hi-IN", "ar-AE"] as const;
export type Locale = (typeof LOCALES)[number];

const FALLBACK: Locale = "en-IN";

// Every template exists in every language. A customer who reads Hindi or Arabic gets the same
// message, not an English one with an apology.
export const TEMPLATES: Record<string, Record<Locale, string>> = {
  out_for_delivery: {
    "en-IN": "Your parcel is out for delivery today.",
    "hi-IN": "आपका पार्सल आज डिलीवरी के लिए निकल चुका है।",
    "ar-AE": "طردك في طريقه إليك اليوم.",
  },
  running_late: {
    "en-IN": "Your parcel was due between {window} and is now expected by {eta}.",
    "hi-IN": "आपका पार्सल {window} के बीच आने वाला था, अब {eta} तक पहुंचेगा।",
    "ar-AE": "كان من المتوقع وصول طردك بين {window} وسيصل الآن بحلول {eta}.",
  },
  delivered: {
    "en-IN": "Your parcel has been delivered.",
    "hi-IN": "आपका पार्सल डिलीवर हो गया है।",
    "ar-AE": "تم تسليم طردك.",
  },
  attempt_failed: {
    "en-IN": "We could not deliver your parcel: {reason}. We will try again.",
    "hi-IN": "हम आपका पार्सल डिलीवर नहीं कर सके: {reason}। हम फिर कोशिश करेंगे।",
    "ar-AE": "تعذر تسليم طردك: {reason}. سنحاول مرة أخرى.",
  },
};

export interface ComposeCommand {
  readonly template: string;
  readonly locale: string;
  readonly values: Record<string, string>;
}

function isLocale(candidate: string): candidate is Locale {
  return (LOCALES as readonly string[]).includes(candidate);
}

export function compose(command: ComposeCommand): string {
  const translations = TEMPLATES[command.template];
  if (translations === undefined) {
    throw new DomainError("invalid_input", `unknown message template: ${command.template}`);
  }

  const locale = isLocale(command.locale) ? command.locale : FALLBACK;
  const text = translations[locale];

  const missing = [...text.matchAll(/\{(\w+)\}/g)]
    .map((match) => match[1])
    .filter((name) => name !== undefined && command.values[name] === undefined);
  if (missing.length > 0) {
    throw new DomainError(
      "invalid_input",
      `the ${command.template} message is missing values: ${missing.join(", ")}`,
    );
  }

  return text.replace(/\{(\w+)\}/g, (whole: string, name: string) => command.values[name] ?? whole);
}
