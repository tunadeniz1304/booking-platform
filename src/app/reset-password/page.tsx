"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import AuthCard, { Notice } from "@/components/auth/AuthCard";

/** E-postadaki bağlantıyla yeni şifre belirleme; başarılıysa tüm oturumlar kapanır. */
export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setState("saving");
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const res = await fetch("/api/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (res.ok) {
      setState("done");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      details?: { fieldErrors?: Record<string, string[]> };
    };
    setError(body.details?.fieldErrors?.password?.[0] ?? body.error ?? t("reset.failed"));
    setState("idle");
  };

  if (state === "done") {
    return (
      <AuthCard title={t("reset.doneTitle")}>
        <Notice kind="success">{t("reset.doneMessage")}</Notice>
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="font-semibold text-[#003580] hover:underline">
            {t("reset.loginLink")}
          </Link>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("reset.title")} subtitle={t("reset.subtitle")}>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            {t("reset.newPassword")}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
          />
        </div>
        <button
          type="submit"
          disabled={state === "saving"}
          className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
        >
          {state === "saving" ? t("saving") : t("reset.submit")}
        </button>
      </form>
      {error && <Notice kind="error">{error}</Notice>}
    </AuthCard>
  );
}
