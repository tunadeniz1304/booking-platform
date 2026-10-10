"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import AuthCard, {
  AuthField,
  authInputClass,
  safeRedirect,
  submitButtonProps,
  useAuthErrorText,
  useSearchParam,
  withRedirect,
} from "@/components/auth/AuthCard";
import PasskeyLoginButton from "@/components/auth/PasskeyLoginButton";
import { solvePow, type PowChallenge, type PowSolution } from "@/lib/auth/pow-solver";

interface LoginResponse {
  user: { id: string; firstName: string; lastName: string; email: string; role: string };
  token: string;
}

interface LoginError {
  error?: string;
  code?: string;
  details?: { pow?: PowChallenge; retryAfterSeconds?: number };
}

export default function LoginPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const authErrorText = useAuthErrorText();
  const redirect = safeRedirect(useSearchParam("redirect"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const goBack = () => {
    // Açık yönlendirme yok: yalnız aynı kökendeki göreli yol (safeRedirect).
    router.push(safeRedirect(new URLSearchParams(window.location.search).get("redirect")));
    router.refresh();
  };

  const attempt = async (pow?: PowSolution) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, ...(pow ? { pow } : {}) }),
    });
    return { res, data: (await res.json().catch(() => ({}))) as LoginResponse & LoginError };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      let { res, data } = await attempt();
      // v4#12: çok deneme sonrası sunucu hesabı kilitlemez, iş kanıtı ister —
      // tarayıcı bulmacayı otomatik çözüp bir kez yeniden dener.
      if (data.code === "POW_REQUIRED" && data.details?.pow) {
        setVerifying(true);
        try {
          ({ res, data } = await attempt(await solvePow(data.details.pow)));
        } finally {
          setVerifying(false);
        }
      }
      if (data.code === "LOGIN_DELAYED") {
        throw new Error(t("login.delayed", { seconds: data.details?.retryAfterSeconds ?? 1 }));
      }
      if (!res.ok) {
        throw new Error(authErrorText(data.code, t("login.failed")));
      }
      goBack();
    } catch (err) {
      setError(
        err instanceof TypeError
          ? authErrorText("NETWORK", t("login.failed"))
          : err instanceof Error
            ? err.message
            : t("login.failed")
      );
      setSubmitting(false);
    }
  };

  return (
    <AuthCard title={t("login.title")} subtitle={t("login.subtitle")}>
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <AuthField id="email" label={t("email")}>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
          />
        </AuthField>

        <AuthField id="password" label={t("password")}>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </AuthField>

        <p className="text-right text-sm">
          <Link
            href={withRedirect("/forgot-password", redirect)}
            className="inline-flex min-h-[44px] items-center text-[#003580] hover:underline sm:min-h-[24px]"
          >
            {t("login.forgotPassword")}
          </Link>
        </p>

        {error && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <button {...submitButtonProps(submitting)}>
          {verifying
            ? t("login.verifying")
            : submitting
              ? t("login.submitting")
              : t("login.submit")}
        </button>
      </form>

      <PasskeyLoginButton onSuccess={goBack} />

      <p className="mt-6 text-center text-sm text-gray-600">
        {t("login.noAccount")}{" "}
        <Link
          href={withRedirect("/register", redirect)}
          className="inline-flex min-h-[44px] items-center font-semibold text-[#003580] hover:underline sm:min-h-[24px]"
        >
          {t("login.registerLink")}
        </Link>
      </p>
    </AuthCard>
  );
}
