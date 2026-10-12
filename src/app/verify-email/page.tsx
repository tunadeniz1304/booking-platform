"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, {
  Notice,
  ResendVerificationButton,
  safeRedirect,
  withRedirect,
} from "@/components/auth/AuthCard";
import { Button, useSession } from "@/components/ui/ui";

/** Kayıt sayfasının doğrulama sonrası dönüş adresini bıraktığı anahtar (localStorage). */
const POST_VERIFY_REDIRECT_KEY = "postVerifyRedirect";

const primaryLinkClass =
  "mt-4 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66]";

/**
 * `retry` / `rateLimited`: ağ hatası, 5xx ya da 429; token tüketilmediği için aynı bağlantıyla
 * tekrar denenebilir. `invalid`: token eksik, kullanılmış ya da süresi dolmuş (4xx).
 */
type VerifyState = "pending" | "ok" | "already" | "invalid" | "retry" | "rateLimited";

async function postToken(token: string): Promise<VerifyState> {
  if (!token) return "invalid";
  let res: Response;
  try {
    res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  } catch {
    return "retry";
  }
  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { alreadyVerified?: boolean } | null;
    return body?.alreadyVerified ? "already" : "ok";
  }
  if (res.status === 429) return "rateLimited";
  return res.status >= 500 ? "retry" : "invalid";
}

/** Kayıttan kalan dönüş adresini okur ve siler (yalnız aynı kökende göreli yol). */
function takePostVerifyRedirect(): string | null {
  try {
    const raw = window.localStorage.getItem(POST_VERIFY_REDIRECT_KEY);
    window.localStorage.removeItem(POST_VERIFY_REDIRECT_KEY);
    const target = safeRedirect(raw);
    return target === "/" ? null : target;
  } catch {
    return null;
  }
}

/** E-posta doğrulama bağlantısının açıldığı sayfa (token tek kullanımlık). */
export default function VerifyEmailPage() {
  const t = useTranslations("auth");
  const session = useSession();
  const [state, setState] = useState<VerifyState>("pending");
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [continueTo, setContinueTo] = useState<string | null>(null);
  const token = useRef("");
  const started = useRef(false);

  const finish = useCallback((next: VerifyState) => {
    if (next === "ok" || next === "already") setContinueTo(takePostVerifyRedirect());
    setState(next);
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Token yoksa sunucuya gitmeden doğrudan "geçersiz bağlantı" + yeniden gönder.
    token.current = new URLSearchParams(window.location.search).get("token") ?? "";
    void postToken(token.current).then(finish);
  }, [finish]);

  async function retry() {
    if (retrying) return;
    setRetrying(true);
    const next = await postToken(token.current);
    setRetrying(false);
    setAttempt((n) => n + 1);
    finish(next);
  }

  const user = session.status === "ready" ? session.user : null;
  const userVerified = user != null && "emailVerified" in user && user.emailVerified === true;
  // Kullanılmış bağlantıya ikinci kez tıklayan, oturumu doğrulanmışsa "zaten doğrulandı" görür.
  let view: VerifyState = state;
  if (state === "invalid" && session.status === "loading") view = "pending";
  else if (state === "invalid" && userVerified) view = "already";

  const verified = view === "ok" || view === "already";
  const canRetry = view === "retry" || view === "rateLimited";
  const title = verified
    ? t("verify.titleOk")
    : view === "invalid"
      ? t("verify.titleInvalid")
      : canRetry
        ? t("verify.titleRetry")
        : t("verify.title");
  // İlk "Doğrulanıyor..." görünür metindir; bölge yalnız sonradan gelen durumu duyurur.
  const announcement = retrying
    ? t("verify.pending")
    : view === "ok"
      ? t("verify.ok")
      : view === "already"
        ? t("verify.alreadyVerified")
        : "";

  return (
    <AuthCard
      title={title}
      focusTitle={attempt > 0 && !canRetry}
      status={<span className="sr-only">{announcement}</span>}
    >
      {view === "pending" && <p className="mt-4 text-sm text-gray-600">{t("verify.pending")}</p>}
      {verified && (
        <>
          <Notice kind="success" live={false}>
            {view === "ok" ? t("verify.ok") : t("verify.alreadyVerified")}
          </Notice>
          {session.status === "ready" && session.user && (
            <Link href={continueTo ?? "/search"} className={primaryLinkClass}>
              {continueTo ? t("verify.continue") : t("verify.searchLink")}
            </Link>
          )}
          {session.status === "ready" && !session.user && (
            <Link href={withRedirect("/login", continueTo ?? "/")} className={primaryLinkClass}>
              {t("verify.loginLink")}
            </Link>
          )}
        </>
      )}
      {canRetry && (
        <>
          <Notice key={attempt} kind="error">
            {view === "rateLimited" ? t("errors.rateLimited") : t("verify.retryError")}
          </Notice>
          <Button
            size="lg"
            fullWidth
            busy={retrying}
            onClick={() => void retry()}
            className="mt-4 min-h-[44px]"
          >
            {t("verify.retry")}
          </Button>
        </>
      )}
      {view === "invalid" && (
        <>
          <Notice key={attempt} kind="error">
            {t("verify.error")}
          </Notice>
          {session.status === "ready" && session.user && (
            <ResendVerificationButton className="mt-4" />
          )}
          {session.status === "ready" && !session.user && (
            <Link href="/login?redirect=%2Fverify-email" className={primaryLinkClass}>
              {t("verify.loginToResendLink")}
            </Link>
          )}
        </>
      )}
      <p className="mt-6 text-center text-sm">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("verify.home")}
        </Link>
      </p>
    </AuthCard>
  );
}
