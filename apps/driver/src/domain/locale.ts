// A driver in the Gulf reads Arabic right to left; a tracking number inside that sentence still
// reads left to right. Getting that wrong scrambles the one string a driver has to read aloud.

export type LocaleCode = "en" | "hi" | "ar" | "xx";
export type Direction = "ltr" | "rtl";

export interface Locale {
  readonly code: LocaleCode;
  readonly name: string;
  readonly direction: Direction;
}

export const LOCALES: readonly Locale[] = [
  { code: "en", name: "English", direction: "ltr" },
  { code: "hi", name: "हिन्दी", direction: "ltr" },
  { code: "ar", name: "العربية", direction: "rtl" },
  { code: "xx", name: "Pseudo", direction: "ltr" },
];

export function directionOf(code: LocaleCode): Direction {
  return LOCALES.find((locale) => locale.code === code)?.direction ?? "ltr";
}

const ENGLISH: Record<string, string> = {
  "app.name": "Runsheet",
  "app.offline": "No signal. Your work is saved.",
  "app.pending": "{count} waiting to send",
  "app.sync": "Send now",
  "app.synced": "Everything sent",
  "action.deliver": "Delivered",
  "action.fail": "Could not deliver",
  "action.pickup": "Picked up",
  "action.skip": "Skip for now",
  "cash.collect": "Collect {amount}",
  "cash.collected": "Cash taken",
  "proof.photo": "Take a photo",
  "proof.signature": "Get a signature",
  "proof.required": "This stop needs {kind}",
  "proof.kind.signature": "a signature",
  "proof.kind.photo": "a photo",
  "proof.kind.otp": "a one-time code",
  "proof.kind.geofence": "you to be at the door",
  "run.start": "Start the run",
  "run.finish": "Finish the run",
  "stops.remaining": "{count} stops left",
  "stops.next": "Next stop",
  "stops.none": "Nothing left to do",
  "error.refused": "The office could not accept {count} of your entries",
};

const HINDI: Record<string, string> = {
  "app.name": "रनशीट",
  "app.offline": "सिग्नल नहीं है। आपका काम सुरक्षित है।",
  "app.pending": "{count} भेजना बाकी",
  "app.sync": "अभी भेजें",
  "app.synced": "सब भेज दिया",
  "action.deliver": "पहुँचा दिया",
  "action.fail": "पहुँचा नहीं सके",
  "action.pickup": "उठा लिया",
  "action.skip": "अभी छोड़ें",
  "cash.collect": "{amount} लें",
  "cash.collected": "नकद ले लिया",
  "proof.photo": "फ़ोटो लें",
  "proof.signature": "हस्ताक्षर लें",
  "proof.required": "इस स्टॉप के लिए {kind} चाहिए",
  "proof.kind.signature": "हस्ताक्षर",
  "proof.kind.photo": "फ़ोटो",
  "proof.kind.otp": "एक बार का कोड",
  "proof.kind.geofence": "दरवाज़े पर होना",
  "run.start": "रन शुरू करें",
  "run.finish": "रन खत्म करें",
  "stops.remaining": "{count} स्टॉप बाकी",
  "stops.next": "अगला स्टॉप",
  "stops.none": "कुछ बाकी नहीं",
  "error.refused": "दफ़्तर ने आपकी {count} एंट्री नहीं लीं",
};

const ARABIC: Record<string, string> = {
  "app.name": "رن‌شيت",
  "app.offline": "لا توجد شبكة. عملك محفوظ.",
  "app.pending": "{count} في انتظار الإرسال",
  "app.sync": "أرسل الآن",
  "app.synced": "تم إرسال كل شيء",
  "action.deliver": "تم التسليم",
  "action.fail": "تعذر التسليم",
  "action.pickup": "تم الاستلام",
  "action.skip": "تخطَّ الآن",
  "cash.collect": "حصّل {amount}",
  "cash.collected": "تم تحصيل النقد",
  "proof.photo": "التقط صورة",
  "proof.signature": "احصل على توقيع",
  "proof.required": "هذه المحطة تتطلب {kind}",
  "proof.kind.signature": "توقيعًا",
  "proof.kind.photo": "صورة",
  "proof.kind.otp": "رمزًا لمرة واحدة",
  "proof.kind.geofence": "وجودك عند الباب",
  "run.start": "ابدأ الجولة",
  "run.finish": "أنهِ الجولة",
  "stops.remaining": "بقيت {count} محطة",
  "stops.next": "المحطة التالية",
  "stops.none": "لم يتبق شيء",
  "error.refused": "لم يقبل المكتب {count} من إدخالاتك",
};

const WIDE: Record<string, string> = {
  a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", c: "ç", n: "ñ", s: "ş", y: "ý",
};

// Translation makes strings longer. The pseudo locale grows every phrase by about a third so a
// layout that only fits English is caught before an operator sees it.
export function pseudo(phrase: string): string {
  // A placeholder is not prose. Accenting it would break the fill and hide the bug until a
  // driver saw a literal brace on screen.
  const accented = phrase
    .split(/(\{\w+\})/)
    .map((part) =>
      part.startsWith("{")
        ? part
        : part.replace(/[a-z]/gi, (character) => WIDE[character.toLowerCase()] ?? character),
    )
    .join("");
  const padding = "·".repeat(Math.ceil(phrase.length * 0.35));
  return `⟦${accented}${padding}⟧`;
}

const PHRASES: Record<LocaleCode, Record<string, string>> = {
  en: ENGLISH,
  hi: HINDI,
  ar: ARABIC,
  xx: Object.fromEntries(Object.entries(ENGLISH).map(([key, value]) => [key, pseudo(value)])),
};

export interface Translator {
  (key: string, values?: Record<string, string>): string;
  readonly phrases: Record<string, string>;
  readonly direction: Direction;
}

function fill(phrase: string, values: Record<string, string> | undefined): string {
  if (values === undefined) return phrase;
  return phrase.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export function translator(code: LocaleCode): Translator {
  const phrases = PHRASES[code];
  const translate = (key: string, values?: Record<string, string>): string =>
    fill(phrases[key] ?? ENGLISH[key] ?? key, values);

  return Object.assign(translate, { phrases, direction: directionOf(code) });
}

// A tracking number or a barcode inside a right-to-left sentence must not be reordered by the
// text around it. The isolate marks say so to every renderer.
const START = "⁦";
const END = "⁩";

export function isolate(value: string): string {
  return value === "" ? "" : `${START}${value}${END}`;
}
