import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Gauge,
  Loader2,
  ShieldCheck,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { scorePost, type QualityReport } from "@/lib/post-quality";
import { improvePostQuality } from "@/lib/post-improve.functions";

type Props = {
  text: string;
  providers: string[];
  hasMedia: boolean;
  bannedWords?: string[];
  tone?: string | undefined;
  industry?: string | undefined;
  /** عند تمريرها تظهر أداة رفع الجودة التلقائي. */
  onApply?: (text: string) => void;
};

const RING: Record<QualityReport["grade"], string> = {
  ممتاز: "text-jade-deep bg-jade/10 border-jade/40",
  جيد: "text-ink-soft bg-secondary border-border",
  "يحتاج تحسين": "text-gold-deep bg-gold/10 border-gold/40",
  ضعيف: "text-coral bg-coral/10 border-coral/40",
};

const scoreRing = (score: number) => {
  if (score >= 90) return "from-jade to-jade-deep";
  if (score >= 75) return "from-gold to-jade";
  if (score >= 55) return "from-gold to-coral";
  return "from-coral to-gold-deep";
};

/**
 * بطاقة «جودة المنشور قبل النشر»: درجة من ١٠٠ لكل منصة مختارة،
 * مع أسباب واضحة وإرشاد مباشر لرفع الجودة. لا تمنع النشر — تُنبّه فقط.
 */
export function PostQuality({
  text,
  providers,
  hasMedia,
  bannedWords = [],
  tone,
  industry,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fixed, setFixed] = useState<string[]>([]);
  const [variants, setVariants] = useState<
    { text: string; score: number; grade: string; angle?: string }[]
  >([]);
  const runImprove = useServerFn(improvePostQuality);

  const reports = useMemo(() => {
    const list = providers.length ? providers : ["facebook"];
    return list
      .map((provider) => scorePost({ text, provider, hasMedia, bannedWords }))
      .sort((a, b) => a.score - b.score);
  }, [text, providers, hasMedia, bannedWords]);

  const weakest = reports[0];

  const improve = async () => {
    if (!weakest) return;
    setBusy(true);
    setError("");
    setFixed([]);
    setVariants([]);
    try {
      const res = await runImprove({
        data: {
          text,
          provider: weakest.provider,
          hasMedia,
          bannedWords,
          ...(tone ? { tone } : {}),
          ...(industry ? { industry } : {}),
          variants: 2,
        },
      });
      if (!res.variants.length) setError("تعذّر توليد نسخة أفضل الآن — جرّب مرة أخرى بعد قليل.");
      setFixed(res.fixed ?? []);
      setVariants(
        res.variants.map((v) => ({ text: v.text, score: v.score, grade: v.grade, angle: v.angle })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذّر رفع الجودة الآن — تحقّق من الاتصال وأعد المحاولة.");
    } finally {
      setBusy(false);
    }
  };

  if (!weakest || !text.trim()) return null;

  return (
    <div className="post-quality-card mt-4 rounded-2xl border border-border bg-card/80 p-3">
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className="h-auto w-full justify-between gap-3 rounded-xl p-0 text-right hover:bg-transparent"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className={`post-quality-score bg-gradient-to-br ${scoreRing(weakest.score)}`}>
            <span>{weakest.score}</span>
            <small>/100</small>
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <Gauge className="size-4 text-muted-foreground" />
              <span className="text-xs font-bold">جودة المنشور قبل النشر</span>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${RING[weakest.grade]}`}
              >
                {weakest.grade}
              </span>
            </span>
            <span className="mt-1 block truncate text-[11px] font-medium text-muted-foreground">
              {weakest.quickFixes[0]?.hint ?? "المنشور مستوفٍ لأهم معايير النشر."}
            </span>
          </span>
          {weakest.blockers.length ? (
            <span className="hidden rounded-full border border-coral/40 bg-coral/10 px-2 py-0.5 text-[11px] font-bold text-coral sm:inline-flex">
              {weakest.blockers.length} مشكلة توقف الجودة
            </span>
          ) : null}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>

      <progress
        className="post-quality-meter mt-3"
        value={weakest.score}
        max={100}
        aria-label={`درجة جودة المنشور ${weakest.score} من 100`}
      />

      {open ? (
        <div className="mt-3 space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <div className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
                <ShieldCheck className="size-3.5 text-jade-deep" /> نقاط قوية
              </div>
              <ul className="mt-2 space-y-1.5">
                {weakest.strengths.slice(0, 4).map((item) => (
                  <li key={item.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-jade-deep" />
                    <span className="text-ink-soft">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border bg-background/70 p-3">
              <div className="flex items-center gap-2 text-[11px] font-bold text-muted-foreground">
                <Sparkles className="size-3.5 text-gold-deep" /> أهم إصلاحات ترفع النتيجة
              </div>
              <ul className="mt-2 space-y-1.5">
                {(weakest.quickFixes.length ? weakest.quickFixes : weakest.checks.slice(0, 3)).map(
                  (item) => (
                    <li key={item.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                      {item.severity === "fail" ? (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-coral" />
                      ) : item.severity === "warn" ? (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-deep" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-jade-deep" />
                      )}
                      <span className="text-ink-soft">{item.hint}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </div>

          {reports.map((r) => (
            <div key={r.provider}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold">{r.providerLabel}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${RING[r.grade]}`}
                >
                  {r.score}/100
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {r.chars} حرفاً · {r.words} كلمة · {r.hashtags.length} هاشتاق · {r.emojis} رمز
                </span>
              </div>
              <ul className="mt-2 space-y-1.5">
                {r.checks
                  .slice()
                  .sort((a, b) =>
                    a.severity === b.severity
                      ? 0
                      : a.severity === "fail"
                        ? -1
                        : b.severity === "fail"
                          ? 1
                          : a.severity === "warn"
                            ? -1
                            : 1,
                  )
                  .map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
                      {c.severity === "pass" ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-jade-deep" />
                      ) : c.severity === "warn" ? (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-gold-deep" />
                      ) : (
                        <XCircle className="mt-0.5 size-3.5 shrink-0 text-coral" />
                      )}
                      <span
                        className={
                          c.severity === "pass" ? "text-muted-foreground" : "text-ink-soft"
                        }
                      >
                        <span className="font-bold">{c.label}</span> — {c.hint}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {onApply ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              onClick={improve}
              disabled={busy}
              variant="outline"
              size="sm"
              className="h-8 rounded-full text-[11px] font-bold"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              {busy ? "أعيد الكتابة بأعلى جودة…" : "ارفع الجودة تلقائياً"}
            </Button>
            <span className="text-[11px] text-muted-foreground">
              نسختان بديلتان بنفس المعنى، بلا أي معلومة جديدة — تختار أنت.
            </span>
          </div>
          {fixed.length ? (
            <p className="mt-2 text-[11px] font-bold text-jade-deep">
              أصلحنا: {fixed.slice(0, 4).join("، ")}
            </p>
          ) : null}
          {error ? <p className="mt-2 text-[11px] font-bold text-coral">{error}</p> : null}
          {variants.length ? (
            <div className="mt-3 space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="rounded-xl border border-border bg-card/70 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold">
                      نسخة {i + 1} · {v.score}/100 · {v.grade}
                    </span>
                    <Button
                      type="button"
                      onClick={() => onApply(v.text)}
                      size="sm"
                      className="h-7 rounded-full px-3 text-[11px] font-bold"
                    >
                      استخدم هذه
                    </Button>
                  </div>
                  {v.angle ? <p className="mt-1 text-[10px] text-muted-foreground">{v.angle}</p> : null}
                  <p
                    className="mt-1.5 max-h-40 overflow-auto whitespace-pre-line text-[11px] leading-relaxed text-ink-soft"
                    dir="auto"
                  >
                    {v.text}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!open ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {weakest.blockers.length
            ? (weakest.blockers[0]?.hint ?? "راجع مشاكل الجودة قبل النشر.")
            : (weakest.checks.find((c) => c.severity === "warn")?.hint ??
              "المنشور مستوفٍ لكل معايير الجودة.")}
        </p>
      ) : null}
    </div>
  );
}
