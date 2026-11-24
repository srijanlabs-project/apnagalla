/**
 * Languages of the app and of printed bills, and the amount in words in each.
 * Number words for Hindi, Gujarati and Punjabi are listed 1–99 (each is its own word in these
 * languages); they are part of the review sheet a native speaker checks.
 */
import { amountInWords as englishAmountInWords } from './words';

export const LANGS = ['en', 'hi', 'gu', 'pa'] as const;
export type Lang = (typeof LANGS)[number];

/** Each language's name in its own script, for pickers. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી', pa: 'ਪੰਜਾਬੀ' };

const words = (s: string) => ['', ...s.trim().split(/\s+/)];

/** 0 = '', 1…99. */
const UPTO_99: Record<Exclude<Lang, 'en'>, string[]> = {
  hi: words(`एक दो तीन चार पाँच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस
    इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस छत्तीस सैंतीस अड़तीस उनतालीस चालीस
    इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस अड़तालीस उनचास पचास इक्यावन बावन तिरपन चौवन पचपन छप्पन सत्तावन अट्ठावन उनसठ साठ
    इकसठ बासठ तिरसठ चौंसठ पैंसठ छियासठ सड़सठ अड़सठ उनहत्तर सत्तर इकहत्तर बहत्तर तिहत्तर चौहत्तर पचहत्तर छिहत्तर सतहत्तर अठहत्तर उन्यासी अस्सी
    इक्यासी बयासी तिरासी चौरासी पचासी छियासी सत्तासी अट्ठासी नवासी नब्बे इक्यानबे बानबे तिरानबे चौरानबे पचानबे छियानबे सत्तानबे अट्ठानबे निन्यानबे`),
  gu: words(`એક બે ત્રણ ચાર પાંચ છ સાત આઠ નવ દસ અગિયાર બાર તેર ચૌદ પંદર સોળ સત્તર અઢાર ઓગણીસ વીસ
    એકવીસ બાવીસ તેવીસ ચોવીસ પચ્ચીસ છવ્વીસ સત્તાવીસ અઠ્ઠાવીસ ઓગણત્રીસ ત્રીસ એકત્રીસ બત્રીસ તેત્રીસ ચોત્રીસ પાંત્રીસ છત્રીસ સાડત્રીસ આડત્રીસ ઓગણચાલીસ ચાલીસ
    એકતાલીસ બેતાલીસ તેતાલીસ ચુંમાલીસ પિસ્તાલીસ છેતાલીસ સુડતાલીસ અડતાલીસ ઓગણપચાસ પચાસ એકાવન બાવન ત્રેપન ચોપન પંચાવન છપ્પન સત્તાવન અઠ્ઠાવન ઓગણસાઠ સાઠ
    એકસઠ બાસઠ ત્રેસઠ ચોસઠ પાંસઠ છાસઠ સડસઠ અડસઠ ઓગણસિત્તેર સિત્તેર એકોતેર બોતેર તોતેર ચુમોતેર પંચોતેર છોતેર સિત્યોતેર ઇઠ્યોતેર ઓગણએંસી એંસી
    એક્યાસી બ્યાસી ત્યાસી ચોર્યાસી પંચાસી છ્યાસી સિત્યાસી ઇઠ્યાસી નેવ્યાસી નેવું એકાણું બાણું ત્રાણું ચોરાણું પંચાણું છન્નું સત્તાણું અઠ્ઠાણું નવ્વાણું`),
  pa: words(`ਇੱਕ ਦੋ ਤਿੰਨ ਚਾਰ ਪੰਜ ਛੇ ਸੱਤ ਅੱਠ ਨੌਂ ਦਸ ਗਿਆਰਾਂ ਬਾਰਾਂ ਤੇਰਾਂ ਚੌਦਾਂ ਪੰਦਰਾਂ ਸੋਲਾਂ ਸਤਾਰਾਂ ਅਠਾਰਾਂ ਉੱਨੀ ਵੀਹ
    ਇੱਕੀ ਬਾਈ ਤੇਈ ਚੌਵੀ ਪੱਚੀ ਛੱਬੀ ਸਤਾਈ ਅਠਾਈ ਉਨੱਤੀ ਤੀਹ ਇਕੱਤੀ ਬੱਤੀ ਤੇਤੀ ਚੌਂਤੀ ਪੈਂਤੀ ਛੱਤੀ ਸੈਂਤੀ ਅਠੱਤੀ ਉਨਤਾਲੀ ਚਾਲੀ
    ਇਕਤਾਲੀ ਬਿਆਲੀ ਤਰਤਾਲੀ ਚੁਤਾਲੀ ਪੰਤਾਲੀ ਛਿਆਲੀ ਸੰਤਾਲੀ ਅਠਤਾਲੀ ਉਨੰਜਾ ਪੰਜਾਹ ਇਕਵੰਜਾ ਬਵੰਜਾ ਤਰਵੰਜਾ ਚਰਵੰਜਾ ਪਚਵੰਜਾ ਛਪੰਜਾ ਸਤਵੰਜਾ ਅਠਵੰਜਾ ਉਨਾਹਠ ਸੱਠ
    ਇਕਾਹਠ ਬਾਹਠ ਤਰੇਹਠ ਚੌਂਹਠ ਪੈਂਹਠ ਛਿਆਹਠ ਸਤਾਹਠ ਅਠਾਹਠ ਉਨਹੱਤਰ ਸੱਤਰ ਇਕਹੱਤਰ ਬਹੱਤਰ ਤਿਹੱਤਰ ਚੌਹੱਤਰ ਪਚੱਤਰ ਛਿਹੱਤਰ ਸਤੱਤਰ ਅਠੱਤਰ ਉਨਾਸੀ ਅੱਸੀ
    ਇਕਾਸੀ ਬਿਆਸੀ ਤਿਰਾਸੀ ਚੁਰਾਸੀ ਪਚਾਸੀ ਛਿਆਸੀ ਸਤਾਸੀ ਅਠਾਸੀ ਉਨੱਨਵੇਂ ਨੱਬੇ ਇਕਾਨਵੇਂ ਬਾਨਵੇਂ ਤਰਾਨਵੇਂ ਚੁਰਾਨਵੇਂ ਪਚਾਨਵੇਂ ਛਿਆਨਵੇਂ ਸਤਾਨਵੇਂ ਅਠਾਨਵੇਂ ਨੜਿੱਨਵੇਂ`),
};

/** hundred, thousand, lakh, crore, zero, "Rupees", "Only", "and", "Paise". */
const UNITS: Record<Exclude<Lang, 'en'>, { hundred: string; thousand: string; lakh: string; crore: string; zero: string; rupees: string; only: string; and: string; paise: string }> = {
  hi: { hundred: 'सौ', thousand: 'हज़ार', lakh: 'लाख', crore: 'करोड़', zero: 'शून्य', rupees: 'रुपये', only: 'मात्र', and: 'और', paise: 'पैसे' },
  gu: { hundred: 'સો', thousand: 'હજાર', lakh: 'લાખ', crore: 'કરોડ', zero: 'શૂન્ય', rupees: 'રૂપિયા', only: 'પૂરા', and: 'અને', paise: 'પૈસા' },
  pa: { hundred: 'ਸੌ', thousand: 'ਹਜ਼ਾਰ', lakh: 'ਲੱਖ', crore: 'ਕਰੋੜ', zero: 'ਸਿਫ਼ਰ', rupees: 'ਰੁਪਏ', only: 'ਮਾਤਰ', and: 'ਅਤੇ', paise: 'ਪੈਸੇ' },
};

/** Whole number in Indian words (hundred / thousand / lakh / crore) for hi, gu or pa. */
export function numberInWords(n: number, lang: Exclude<Lang, 'en'>): string {
  const w = UPTO_99[lang];
  const u = UNITS[lang];
  n = Math.floor(Math.abs(n));
  if (n === 0) return u.zero;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (crore) parts.push(`${numberInWords(crore, lang)} ${u.crore}`);
  if (lakh) parts.push(`${w[lakh]} ${u.lakh}`);
  if (thousand) parts.push(`${w[thousand]} ${u.thousand}`);
  if (hundred) parts.push(`${w[hundred]} ${u.hundred}`);
  if (rest) parts.push(w[rest]!);
  return parts.join(' ');
}

/** "Rupees … Only" in the bill's language. */
export function amountInWordsIn(paise: number, lang: Lang): string {
  if (lang === 'en') return englishAmountInWords(paise);
  const u = UNITS[lang];
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const r = `${u.rupees} ${numberInWords(rupees, lang)}`;
  return p ? `${r} ${u.and} ${UPTO_99[lang][p]} ${u.paise} ${u.only}` : `${r} ${u.only}`;
}

/** For tests and the review sheet. */
export const NUMBER_WORDS = UPTO_99;
