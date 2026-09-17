/**
 * فاحص جودة حتمي لمخرجات الموظفين غير المنشورات (مقال، بريد، تقرير، مقترح، موجز تصميم).
 *
 * المنشورات لها مقياسها الخاص (post-quality.ts). هذا الملف يغطي بقية المخرجات
 * بنفس المنطق: قواعد قابلة للقياس لا آراء — بقايا فراغات، بتر، حشو، جداول ناقصة،
 * مهام بلا مسؤول أو تاريخ، أرقام بلا مصدر، وطول لا يناسب نوع المخرج.
 *
 * مخرجه قائمة «إصلاحات إلزامية» تُمرَّر لحَكَم الجودة فيعيد الكتابة على أساسها،
 * فلا يعتمد الحكم على تقدير النموذج وحده.
 */

export type OutputIssue = { id: string; hint: string };

export type OutputAudit = {
  /** خصم من ١٠٠ بحسب خطورة ما وُجد (٠ = لا ملاحظات). */
  penalty: number;
  issues: OutputIssue[];
};

/** بقايا فراغات القوالب التي يجب ألّا تصل للمالك أبداً. */
const PLACEHOLDER = [
  /\{\{[^}]{1,60}\}\}/,
  /\[(?:اسم|رابط|السعر|التاريخ|المدينة|المنتج|العلامة|الشركة)[^\]]{0,40}\]/,
  /\b(?:XXX|TBD|TODO|Lorem ipsum)\b/i,
  /«?(?:اسم المنصة|اسم العميل|اسم المنتج)»?/,
];

/** عبارات تدل على أن المخرج توقف في منتصفه بدل إكماله. */
const TRUNCATION = [
  /وهكذا\s*$/m,
  /باقي (?:الأيام|الأسابيع|البنود) (?:مشابهة|مثلها|بنفس)/,
  /\(?يُكمل لاحقاً\)?/,
  /^\s*\.{3,}\s*$/m,
];

/** حشو لغوي بلا معلومة — يُستبدل بمحتوى أو يُحذف. */
const FILLER = [
  "في عالم اليوم",
  "لا يخفى على أحد",
  "مما لا شك فيه",
  "في ظل التطور",
  "كما نعلم جميعاً",
  "الجدير بالذكر",
  "بلا شك",
  "في نهاية المطاف",
];

/** ادعاءات مطلقة تحتاج دليلاً أو تخفيفاً. */
const OVERCLAIM = [
  "الأفضل في العالم",
  "نتيجة مضمونة",
  "مضمون 100",
  "بلا أي مخاطر",
  "الأول عالمياً",
  "لا مثيل له",
];

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** هل يوجد تاريخ أو مدة محددة في النص (يوم/شهر/تاريخ رقمي/بعد N أيام)؟ */
function hasDate(text: string): boolean {
  return (
    /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(text) ||
    /(?:الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|السبت)/.test(text) ||
    /(?:يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر)/.test(text) ||
    /خلال\s*\d+\s*(?:يوم|أيام|أسبوع|أسابيع)/.test(text) ||
    /(?:اليوم|غداً|بعد غد)\b/.test(text)
  );
}

/** جداول Markdown ناقصة: صف بعدد أعمدة مختلف عن رأس الجدول. */
function brokenTable(text: string): boolean {
  const lines = text.split("\n");
  let headerCols = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      headerCols = 0;
      continue;
    }
    const cols = trimmed.split("|").filter((c) => c.trim().length).length;
    if (/^\|[\s:|-]+\|?$/.test(trimmed)) continue;
    if (!headerCols) headerCols = cols;
    else if (cols && Math.abs(cols - headerCols) > 1) return true;
  }
  return false;
}

/** نوع المخرج المستنتج من الطلب ونص المخرج نفسه. */
export type OutputKind = "email" | "article" | "report" | "proposal" | "plan" | "generic";

export function detectKind(request: string, text: string, employeeId: string): OutputKind {
  const all = `${request}\n${text}`.toLowerCase();
  const ar = `${request}\n${text}`;
  if (/\b(email|subject)\b/.test(all) || /(?:رسالة|بريد|رد على|الموضوع:)/.test(ar)) return "email";
  if (/(?:مقال|تدوينة|محتوى الصفحة|meta description|وصف ميتا)/i.test(ar) || employeeId === "nour")
    return "article";
  if (/(?:تقرير|تحليل الأداء|لوحة مؤشرات|قراءة الأرقام)/.test(ar) || employeeId === "adam")
    return "report";
  if (/(?:مقترح|عرض سعر|proposal|تسعير)/i.test(ar)) return "proposal";
  if (/(?:خطة|جدول محتوى|رزنامة|roadmap)/i.test(ar)) return "plan";
  return "generic";
}

/**
 * يفحص مخرجاً نصياً ويعيد ملاحظات إصلاح محددة. لا يستدعي أي نموذج — حتمي وسريع.
 */
export function auditOutput(input: {
  text: string;
  employeeId: string;
  request?: string;
  bannedWords?: string[];
  kind?: OutputKind;
}): OutputAudit {
  const text = (input.text ?? "").trim();
  const issues: OutputIssue[] = [];
  let penalty = 0;
  if (text.length < 40) return { penalty: 0, issues };

  const kind = input.kind ?? detectKind(input.request ?? "", text, input.employeeId);
  const add = (id: string, hint: string, cost: number) => {
    if (issues.some((i) => i.id === id)) return;
    issues.push({ id, hint });
    penalty += cost;
  };

  if (PLACEHOLDER.some((re) => re.test(text)))
    add(
      "placeholder",
      "احذف كل فراغ قالب ([اسم…]، {{…}}، XXX) واستبدله بمعلومة حقيقية من سياق المالك أو بصياغة طبيعية بلا فراغ.",
      18,
    );

  if (TRUNCATION.some((re) => re.test(text)))
    add(
      "truncated",
      "أكمل المخرج حتى آخر بند مطلوب واحذف عبارات مثل «وهكذا» أو «باقي الأيام مشابهة».",
      16,
    );

  if (brokenTable(text))
    add("table", "أكمل صفوف الجدول بحيث يتساوى عدد الأعمدة في كل صف مع رأس الجدول.", 10);

  const filler = FILLER.filter((f) => text.includes(f));
  if (filler.length)
    add("filler", `احذف الحشو بلا معلومة: ${filler.slice(0, 3).join("، ")}، وضع محتوى محدداً مكانه.`, 8);

  const over = OVERCLAIM.filter((f) => text.includes(f));
  if (over.length)
    add("overclaim", `احذف الادعاء المطلق (${over[0]}) أو اربطه بدليل محدد.`, 12);

  const banned = (input.bannedWords ?? []).filter((w) => w.trim() && text.includes(w.trim()));
  if (banned.length)
    add("banned", `احذف الكلمات الممنوعة في صوت العلامة: ${banned.slice(0, 3).join("، ")}.`, 20);

  // تكرار فقرة كاملة — علامة على لصق مزدوج.
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 80);
  if (new Set(paras).size < paras.length)
    add("duplicate", "احذف الفقرة المكرّرة وأبقِ ظهورها الأول فقط.", 10);

  if (kind === "email") {
    if (words(text) > 200)
      add("email-length", "اختصر الرسالة إلى أقل من ١٢٠ كلمة مع إبقاء الطلب الواحد واضحاً.", 10);
    if (!/(?:الموضوع|Subject)\s*[:：]/i.test(text))
      add("email-subject", "أضف سطر «الموضوع:» من ٣–٥ كلمات بلا كلمات دعائية.", 8);
    if (!/[؟?]|(?:أرجو|هل يناسبك|يمكنك|نلتقي|أرسل|أكّد)/.test(text))
      add("email-cta", "أنهِ الرسالة بطلب واحد سهل وواضح (سؤال نعم/لا أو موعد محدد).", 10);
  }

  if (kind === "article") {
    const heads = (text.match(/^#{2,3}\s+\S/gm) ?? []).length;
    if (words(text) > 300 && heads < 3)
      add("article-structure", "قسّم المقال بعناوين فرعية (H2/H3) كل ١٥٠–٢٥٠ كلمة.", 10);
    const meta = text.match(/(?:وصف ميتا|meta description)\s*[:：]\s*(.+)/i)?.[1]?.trim();
    if (meta && (meta.length < 110 || meta.length > 160))
      add("article-meta", `اضبط وصف الميتا بين ١٢٠ و١٥٥ حرفاً (الحالي ${meta.length}).`, 8);
    const title = text.match(/(?:عنوان ميتا|meta title|عنوان الصفحة)\s*[:：]\s*(.+)/i)?.[1]?.trim();
    if (title && title.length > 62)
      add("article-title", `اختصر عنوان الميتا إلى ٦٠ حرفاً أو أقل (الحالي ${title.length}).`, 8);
  }

  if (kind === "report") {
    if (!/\d/.test(text))
      add("report-numbers", "أضف الأرقام الفعلية التي يستند إليها التحليل بدل الوصف العام.", 14);
    if (!/(?:المصدر|حسب بيانات|من حساب|وفق)/.test(text))
      add("report-source", "اذكر مصدر كل رقم (حساب مربوط، تقدير، بيانات المالك) في سطر واحد.", 10);
    if (!/(?:التوصية|الخطوة التالية|ما نفعله)/.test(text))
      add("report-action", "أنهِ التقرير بتوصيات قابلة للتنفيذ مرتّبة بالأولوية.", 12);
  }

  if (kind === "proposal") {
    if (!/(?:السعر|التكلفة|الاستثمار|ر\.س|ج\.م|د\.إ|\$)/.test(text))
      add("proposal-price", "أضف قسم السعر بثلاثة خيارات أو سطراً يوضّح أن التسعير بانتظار معطيات المالك.", 12);
    if (!/(?:خارج النطاق|لا يشمل)/.test(text))
      add("proposal-scope", "أضف «خارج النطاق» حتى لا يتوسع العمل بلا مقابل.", 8);
    if (!hasDate(text))
      add("proposal-date", "أضف خطاً زمنياً وتاريخ صلاحية للعرض.", 10);
  }

  if (kind === "plan") {
    if (!hasDate(text)) add("plan-date", "اربط كل بند بيوم أو تاريخ محدد.", 12);
    if (!/(?:المسؤول|مسؤول|ينفّذه|صاحب المهمة)/.test(text) && /(?:مهام|مهمة)/.test(text))
      add("plan-owner", "حدّد مسؤولاً لكل مهمة ومعيار إنجاز واضحاً.", 10);
  }

  // مهام بلا تاريخ في مخرجات التنفيذ اليومي (إيفا خصوصاً).
  if (input.employeeId === "eva" && /(?:مهام|المتابعات|خطوات)/.test(text) && !hasDate(text))
    add("eva-date", "أعطِ كل مهمة ومتابعة تاريخاً محدداً بدل «قريباً» أو «لاحقاً».", 10);

  return { penalty: Math.min(60, penalty), issues: issues.slice(0, 5) };
}
