// Free translation (no key / no sign-up): Google Translate public endpoint, MyMemory as fallback.
const HEB = /[֐-׿]/;
const cache = new Map();

async function google(text, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('google ' + r.status);
  const j = await r.json();
  return (j[0] || []).map((x) => x[0]).join('');
}
async function myMemory(text, tl) {
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 480))}&langpair=he|${tl}`);
  const j = await r.json();
  if (j.responseStatus !== 200) throw new Error('mymemory');
  return j.responseData.translatedText;
}
export async function translate(text, tl = 'en') {
  const t = String(text || '').trim();
  if (!t || !HEB.test(t)) return t;
  const key = tl + '|' + t;
  if (cache.has(key)) return cache.get(key);
  let out;
  try { out = await google(t, tl); } catch { try { out = await myMemory(t, tl); } catch { out = t; } }
  cache.set(key, out);
  return out;
}
// Translate many short strings in one request (joined by line breaks)
export async function translateMany(list, tl = 'en') {
  const idx = list.map((s, i) => [i, s]).filter(([, s]) => s && HEB.test(s));
  const out = [...list];
  if (!idx.length) return out;
  try {
    const joined = idx.map(([, s]) => s.replace(/\n+/g, ' ')).join('\n');
    const res = (await google(joined, tl)).split('\n');
    if (res.length === idx.length) { idx.forEach(([i], k) => (out[i] = res[k].trim())); return out; }
  } catch {}
  for (const [i, s] of idx) out[i] = await translate(s, tl);
  return out;
}

// ---------- positive quote picker (used when Claude isn't configured) ----------
const POS = ['מצוין', 'מצוינת', 'מעולה', 'מעולים', 'מרשים', 'מרשימה', 'מרשימים', 'נהדר', 'נהדרת', 'מושלם', 'מושלמת', 'מדהים', 'מדהימה', 'מהיר', 'מהירה', 'חזק', 'חזקה', 'איכות', 'איכותי', 'איכותית',
  'נוח', 'נוחה', 'בהיר', 'בהירה', 'חד', 'חדה', 'יפה', 'אלגנטי', 'אלגנטית', 'מומלץ', 'ממליץ', 'ממליצים', 'אהבנו', 'אהבתי', 'שווה', 'משופר', 'משופרת', 'שדרוג', 'חלק', 'חלקה', 'קל', 'קלה', 'עמיד', 'עמידה',
  'ארוך', 'ארוכה', 'יתרון', 'פרימיום', 'מתקדם', 'מתקדמת', 'חדשני', 'חדשנית', 'הטוב', 'הטובה', 'הכי', 'מפתיע', 'מפתיעה', 'נפלא', 'נפלאה', 'שימושי', 'שימושית', 'בוגר', 'בוגרת', 'סוללה', 'מסך', 'מצלמה', 'ביצועים',
  'excellent', 'great', 'impressive', 'best', 'amazing', 'smooth', 'fast', 'bright', 'comfortable', 'premium', 'love', 'recommend', 'improved', 'perfect', 'beautiful', 'solid', 'powerful'];
const NEG = ['אבל', 'חסרון', 'חסרונות', 'לצערנו', 'לצערי', 'מאכזב', 'מאכזבת', 'בעיה', 'בעייתי', 'יקר', 'יקרה', 'איטי', 'איטית', 'חבל', 'פחות', 'לא מספיק', 'מחיר', 'however', 'but', 'disappoint', 'expensive', 'slow', 'issue', 'problem', 'lacks'];

export function pickPositive(paras, max = 5) {
  const sentences = [];
  (paras || []).forEach((p, pi) => {
    p.split(/(?<=[.!?])\s+/).forEach((s, si) => {
      const t = s.trim();
      if (t.length < 45 || t.length > 260) return;
      if (/https?:|@|©|כל הזכויות|לחצו|הירשמו|קראו עוד|מודעה|פרסומת/.test(t)) return;
      const low = t.toLowerCase();
      const pos = POS.filter((w) => low.includes(w)).length;
      const neg = NEG.filter((w) => low.includes(w)).length;
      if (!pos || neg) return;
      sentences.push({ t, score: pos * 2 - neg + (/גלקסי|galaxy|סמסונג|samsung|fold|flip|watch|פולד|פליפ/i.test(t) ? 1 : 0), order: pi * 100 + si });
    });
  });
  return sentences.sort((a, b) => b.score - a.score).slice(0, max).sort((a, b) => a.order - b.order).map((x) => x.t);
}
export const quoteMarks = (s) => `“${String(s).replace(/^["“”'\s]+|["“”'\s]+$/g, '')}”`;
