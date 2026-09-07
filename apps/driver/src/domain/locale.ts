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
  "console.title": "Runsheet",
  "console.signin": "Paste your key to sign in",
  "console.signin.action": "Sign in",
  "console.signout": "Sign out",
  "console.board": "Board",
  "console.consignments": "Consignments",
  "console.exceptions": "Exceptions",
  "console.hub": "Hub floor",
  "console.linehaul": "Linehaul",
  "console.cash": "Cash",
  "console.settlements": "Settlements",
  "console.policies": "Policies",
  "console.reports": "Reports",
  "console.driver": "Driver app",
  "console.language": "Language",
  "console.loading": "Loading",
  "console.empty": "Nothing here yet",
  "console.error": "Something went wrong: {message}",
  "console.search": "Search",
  "console.hub_id": "Hub",
  "console.date": "Date",
  "console.refresh": "Refresh",
  "console.new": "{count} new",
  "console.status": "Status",
  "console.reference": "Reference",
  "console.service": "Service",
  "console.lane": "Lane",
  "console.driver_id": "Driver",
  "console.severity": "Severity",
  "console.type": "Type",
  "console.opened": "Opened",
  "console.amount": "Amount",
  "console.variance": "Variance",
  "console.approve": "Approve",
  "console.dispute": "Dispute",
  "console.download": "Download",
  "console.run": "Run",
  "console.from": "From",
  "console.to": "To",
  "console.scan_in": "Scan in",
  "console.scan_out": "Scan out",
  "console.barcode": "Barcode",
  "console.weight": "Weight (g)",
  "console.scanned": "Scanned",
  "console.refused": "Refused: {reason}",
  "console.close_run": "Close the run",
  "console.counted": "Counted",
  "console.close": "Close",
  "console.state": "State",
  "console.trigger": "Trigger",
  "console.stops": "Stops",
  "console.no_key": "Signed out",
  "console.triage": "Take it",
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
  "console.title": "रनशीट",
  "console.signin": "साइन इन करने के लिए अपनी कुंजी चिपकाएँ",
  "console.signin.action": "साइन इन",
  "console.signout": "साइन आउट",
  "console.board": "बोर्ड",
  "console.consignments": "खेप",
  "console.exceptions": "अपवाद",
  "console.hub": "हब फ़्लोर",
  "console.linehaul": "लाइनहॉल",
  "console.cash": "नकद",
  "console.settlements": "निपटान",
  "console.policies": "नीतियाँ",
  "console.reports": "रिपोर्ट",
  "console.driver": "ड्राइवर ऐप",
  "console.language": "भाषा",
  "console.loading": "लोड हो रहा है",
  "console.empty": "अभी यहाँ कुछ नहीं",
  "console.error": "कुछ गड़बड़ हुई: {message}",
  "console.search": "खोजें",
  "console.hub_id": "हब",
  "console.date": "तारीख़",
  "console.refresh": "ताज़ा करें",
  "console.new": "{count} नए",
  "console.status": "स्थिति",
  "console.reference": "संदर्भ",
  "console.service": "सेवा",
  "console.lane": "लेन",
  "console.driver_id": "ड्राइवर",
  "console.severity": "गंभीरता",
  "console.type": "प्रकार",
  "console.opened": "खुला",
  "console.amount": "राशि",
  "console.variance": "अंतर",
  "console.approve": "मंज़ूर करें",
  "console.dispute": "विवाद करें",
  "console.download": "डाउनलोड",
  "console.run": "चलाएँ",
  "console.from": "से",
  "console.to": "तक",
  "console.scan_in": "स्कैन इन",
  "console.scan_out": "स्कैन आउट",
  "console.barcode": "बारकोड",
  "console.weight": "वज़न (ग्राम)",
  "console.scanned": "स्कैन हुआ",
  "console.refused": "अस्वीकृत: {reason}",
  "console.close_run": "रन बंद करें",
  "console.counted": "गिना गया",
  "console.close": "बंद करें",
  "console.state": "अवस्था",
  "console.trigger": "ट्रिगर",
  "console.stops": "स्टॉप",
  "console.no_key": "साइन आउट हैं",
  "console.triage": "संभालें",
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
  "console.title": "رن‌شيت",
  "console.signin": "الصق مفتاحك لتسجيل الدخول",
  "console.signin.action": "تسجيل الدخول",
  "console.signout": "تسجيل الخروج",
  "console.board": "اللوحة",
  "console.consignments": "الشحنات",
  "console.exceptions": "الاستثناءات",
  "console.hub": "أرضية المستودع",
  "console.linehaul": "النقل بين المدن",
  "console.cash": "النقد",
  "console.settlements": "التسويات",
  "console.policies": "السياسات",
  "console.reports": "التقارير",
  "console.driver": "تطبيق السائق",
  "console.language": "اللغة",
  "console.loading": "جارٍ التحميل",
  "console.empty": "لا شيء هنا بعد",
  "console.error": "حدث خطأ: {message}",
  "console.search": "بحث",
  "console.hub_id": "المستودع",
  "console.date": "التاريخ",
  "console.refresh": "تحديث",
  "console.new": "{count} جديد",
  "console.status": "الحالة",
  "console.reference": "المرجع",
  "console.service": "الخدمة",
  "console.lane": "المسار",
  "console.driver_id": "السائق",
  "console.severity": "الخطورة",
  "console.type": "النوع",
  "console.opened": "فُتح",
  "console.amount": "المبلغ",
  "console.variance": "الفرق",
  "console.approve": "اعتماد",
  "console.dispute": "اعتراض",
  "console.download": "تنزيل",
  "console.run": "تشغيل",
  "console.from": "من",
  "console.to": "إلى",
  "console.scan_in": "مسح الدخول",
  "console.scan_out": "مسح الخروج",
  "console.barcode": "الرمز الشريطي",
  "console.weight": "الوزن (غ)",
  "console.scanned": "تم المسح",
  "console.refused": "مرفوض: {reason}",
  "console.close_run": "إغلاق الجولة",
  "console.counted": "المعدود",
  "console.close": "إغلاق",
  "console.state": "الوضع",
  "console.trigger": "المحفّز",
  "console.stops": "المحطات",
  "console.no_key": "غير مسجّل الدخول",
  "console.triage": "تولَّها",
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
