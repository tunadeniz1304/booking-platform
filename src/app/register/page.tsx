"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { postJsonWithPow } from "@/lib/auth/pow-fetch";

interface RegisterResponse {
  user: { id: string; firstName: string; lastName: string; email: string; role: string };
  token: string;
}

export default function RegisterPage() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await postJsonWithPow("/api/auth/register", {
        firstName,
        lastName,
        email,
        password,
      });
      const data = (await res.json()) as RegisterResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? t("register.failed"));
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("register.failed"));
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-16"
      >
        <div className="w-full rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-gray-900">{t("register.title")}</h1>
          <p className="mt-1 text-sm text-gray-600">{t("register.subtitle")}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                  {t("register.firstName")}
                </label>
                <input
                  id="firstName"
                  type="text"
                  required
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                  {t("register.lastName")}
                </label>
                <input
                  id="lastName"
                  type="text"
                  required
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                {t("email")}
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                {t("password")}
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("register.passwordPlaceholder")}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
              />
              {password.length > 0 && (!/[0-9]/.test(password) || password.length < 8) && (
                <p className="mt-1 text-xs text-red-600">{t("register.passwordHint")}</p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-700"
            >
              {submitting ? t("saving") : t("register.submit")}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            {t("register.haveAccount")}{" "}
            <Link href="/login" className="font-semibold text-[#003580] hover:underline">
              {t("register.loginLink")}
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
