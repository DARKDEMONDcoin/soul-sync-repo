/**
 * حَكَم الجودة — طبقة مراجعة إلزامية قبل أن يرى المالك أي مخرج.
 * يقيس المخرج على معايير القبول الخاصة بالقدرة، ويعيد كتابته مرة واحدة
 * عند رسوبه، ثم يحتفظ بالأفضل. لا يخترع محتوى جديداً ولا يحذف حقائق.
 */
import { freeChat } from "./nour-research.server";
import { auditOutput } from "./output-quality";


export type JudgeVerdict = {
  /** الدرجة النهائية من ١٠٠ (بعد الإصلاح إن حدث). */
  score: number;
  /** ملاحظات الحَكَم على النسخة الأصلية. */
  issues: string[];
  /** المخرج النهائي — الأصلي أو المُحسَّن. */
  output: string;
  revised: boolean;
};

export type JudgeInput = {
  employeeId: string;
  request: string;
  output: string;
  criteria?: string[];
  bannedWords?: string[];
  /** حد النجاح (افتراضياً ٨٢). */
  threshold?: number;
};

const JUDGE_SYSTEM = [
  "أنت حَكَم جودة صارم لمخرجات موظف عربي محترف. لا تكتب المخرج، بل تحكم عليه فقط.",
  "قيّم: تلبية الطلب حرفياً، الاكتمال، الدقة والقابلية للتنفيذ، الوضوح العربي الطبيعي (بلا نبرة آلية)،",
  "الالتزام بمعايير القبول والكلمات الممنوعة، وخلوّه من الحشو والوعود المبالغ فيها.",
  "قواعد حكم عادلة (إلزامية): إن انتهى المخرج بعلامة «…» فهو مقتطع للعرض فقط — لا تخصم على «عدم الاكتمال» بسببها.",
  "لا تخصم على غياب معلومة لم يعطها المالك ووُضعت بين قوسين ليملأها، ولا على تصريح الموظف بأن رقماً تقديري أو أن حساباً غير مربوط — هذه صحّة لا نقص.",
  "كل رقم أو حقيقة ذكرها المالك في طلبه (سعر، نسبة، مدة، عدد صفحات، هبوط ترافيك) معطى ثابت: إعادة استخدامه في المخرج صحيحة تماماً ولا تُخصم عليها ولا تطلب له مصدراً.",
  "لا تخصم على الطول ما دام كل جزء يخدم الطلب، ولا على غياب بند لم يطلبه المالك.",
  "درجة ٨٢ وأعلى تعني «صالح للتسليم كما هو». اخصم فقط على خلل حقيقي: بند مطلوب مفقود، رقم أو حساب خاطئ، ادعاء مخترع، حشو، تناقض، أو مخالفة معيار قبول.",
  'أعد JSON فقط: {"score": 0-100, "issues": ["ملاحظة قابلة للإصلاح", "..."]}',
  "issues: أربع ملاحظات كحد أقصى، كل واحدة إصلاح محدد لا وصف عام. إن كان المخرج ممتازاً أعد قائمة فارغة.",
].join("\n");

const FIX_SYSTEM = [
  "أنت محرّر عربي من الطراز الأول. أعد كتابة المخرج التالي لإصلاح الملاحظات المذكورة فقط.",
  "قواعد صارمة: لا تحذف أي معلومة أو رقم أو عنوان موجود، ولا تخترع أي معلومة جديدة،",
  "حافظ على نفس البنية والتنسيق (Markdown/عناوين/قوائم).",
  "ممنوع تماماً اختراع أي رقم أو نسبة أو سعر أو تاريخ أو مدة غير موجودة في المخرج الأصلي.",
  "إن طلبت ملاحظةٌ معلومة غير متوفرة، اكتب مكانها صياغة عامة بلا رقم مخترع.",
  "أعد النص النهائي فقط بلا أي مقدمة أو تعليق.",
].join("\n");

function parseScore(raw: string): { score: number; issues: string[] } | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      score?: unknown;
      issues?: unknown;
    };
    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .filter((i): i is string => typeof i === "string" && i.trim().length > 3)
          .map((i) => i.trim().slice(0, 200))
          .slice(0, 4)
      : [];
    return { score, issues };
  } catch {
    return null;
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * يراجع المخرج ويحسّنه مرة واحدة عند الحاجة. لا يفشل أبداً: عند أي خطأ
 * يعيد المخرج الأصلي كما هو حتى لا تتأثر تجربة المالك.
 */
export async function judgeAndImprove(input: JudgeInput): Promise<JudgeVerdict> {
  const original = input.output ?? "";
  const fallback: JudgeVerdict = { score: 0, issues: [], output: original, revised: false };
  // المخرجات القصيرة (كابشن، تغريدة، رسالة باردة) تُراجَع أيضاً — هي الأكثر استخداماً.
  if (original.trim().length < 60) return fallback;


  const threshold = input.threshold ?? 82;
  // فحص حتمي قبل حكم النموذج: بقايا فراغات، بتر، جداول ناقصة، حشو، ادعاءات، كلمات ممنوعة،
  // ونواقص خاصة بنوع المخرج (بريد/مقال/تقرير/مقترح/خطة). هذه ملاحظات لا تحتمل التقدير،
  // فتُفرض على الحَكَم بدل انتظار أن ينتبه لها النموذج من تلقاء نفسه.
  const audit = auditOutput({
    text: original,
    employeeId: input.employeeId,
    request: input.request,
    bannedWords: input.bannedWords ?? [],
  });
  const mustFix = audit.issues.map((i) => i.hint);

  // المخرج يُعرض للحَكَم كاملاً تقريباً: القطع عند ٩ آلاف حرف كان يجعله يحكم على نص
  // ناقص فيخصم على «عدم الاكتمال» ظلماً ويُطلق إصلاحاً لا داعي له (وقت مهدور).
  const brief = [
    `طلب المالك:\n${clip(input.request, 1200)}`,
    input.criteria?.length ? `معايير القبول:\n- ${input.criteria.join("\n- ")}` : "",
    input.bannedWords?.length ? `كلمات ممنوعة تماماً: ${input.bannedWords.join("، ")}` : "",
    mustFix.length ? `أخطاء رصدها فاحص آلي (خذها بعين الاعتبار):\n- ${mustFix.join("\n- ")}` : "",
    `المخرج:\n${clip(original, 28_000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");


  let verdict: { score: number; issues: string[] } | null = null;
  try {
    verdict = parseScore(
      await freeChat(
        "",
        [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: brief },
        ],
        { json: true, maxTokens: 500, timeoutMs: 25_000, attempts: 1 },
      ),
    );
  } catch {
    return fallback;
  }
  if (!verdict) {
    // الحَكَم لم يجب، لكن الفحص الحتمي رصد خللاً مؤكداً — نصلحه بدل تسليم مخرج معطوب.
    if (!mustFix.length) return fallback;
    verdict = { score: Math.max(0, 82 - audit.penalty), issues: [] };
  }
  // ملاحظات الفاحص الحتمي إلزامية: حتى لو رضي الحَكَم عن المخرج، فراغ قالب أو جدول ناقص
  // أو كلمة ممنوعة خلل مؤكد لا يجوز تسليمه.
  const issues = [...new Set([...mustFix, ...verdict.issues])].slice(0, 6);
  const score = Math.max(0, verdict.score - audit.penalty);
  if (!issues.length || (score >= threshold && !mustFix.length)) {
    return { score: verdict.score, issues: verdict.issues, output: original, revised: false };
  }
  verdict = { score, issues };


  // الإصلاح الموجّه يشمل الآن المخرجات الطويلة أيضاً (مقال ركيزة، خطة، تقرير) لأنها
  // أكبر أثراً عند الرسوب. حاجز الطول أدناه (٧٠٪ من الأصل) يمنع فقدان المحتوى،
  // وما يتجاوز هذا الحجم فعلاً تصعب إعادة كتابته في نداء واحد بلا بتر.
  if (original.length > 14_000) {
    return { score: verdict.score, issues: verdict.issues, output: original, revised: false };
  }


  try {
    const fixed = (
      await freeChat(
        "",
        [
          { role: "system", content: FIX_SYSTEM },
          {
            role: "user",
            content: [
              `الملاحظات المطلوب إصلاحها:\n- ${verdict.issues.join("\n- ")}`,
              input.bannedWords?.length ? `كلمات ممنوعة: ${input.bannedWords.join("، ")}` : "",
              `المخرج الحالي:\n${original}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
        { maxTokens: 14_000, timeoutMs: 90_000, attempts: 1 },
      )
    ).trim();

    // المخرجات الطويلة (مقال/تقرير) لا تُقبل أقصر بشكل مريب — فقدان محتوى.
    // أما المنشورات القصيرة فالاختصار غالباً هو الإصلاح المطلوب.
    const longForm = original.length > 1500;
    const floor = longForm ? original.length * 0.7 : 80;
    if (fixed.length < floor) {
      return { score: verdict.score, issues: verdict.issues, output: original, revised: false };
    }

    // لا نعتمد نسخة أسوأ من الأصل: نعيد فحصها حتمياً ونقارن.
    const after = auditOutput({
      text: fixed,
      employeeId: input.employeeId ?? "",
      request: input.request,
      bannedWords: input.bannedWords,
    });
    if (after.penalty > audit.penalty) {
      return { score: verdict.score, issues: verdict.issues, output: original, revised: false };
    }

    // النسخة المُصلَحة عالجت ملاحظات محددة بلا حذف — نعتمدها بدرجة عتبة التسليم
    // بدل استهلاك نداء ثالث في إعادة الحكم (كان يضيف نصف دقيقة لكل رد).
    return {
      score: Math.max(verdict.score, threshold - after.penalty),
      issues: after.issues.map((i) => i.hint),
      output: fixed,
      revised: true,
    };

  } catch {
    return { score: verdict.score, issues: verdict.issues, output: original, revised: false };
  }
}
