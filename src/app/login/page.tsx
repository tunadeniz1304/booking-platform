"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

interface LoginResponse {
  user: { id: string; firstName: string; lastName: string; email: string; role: string };
  token: string;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json()) as LoginResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Giriş yapılamadı");
      }
      const redirect = new URLSearchParams(window.location.search).get("redirect") ?? "/";
      router.push(redirect);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Giriş yapılamadı");
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
          <h1 className="text-2xl font-bold text-gray-900">Giriş Yap</h1>
          <p className="mt-1 text-sm text-gray-600">
            Rezervasyonlarınıza ve favorilerinize erişin.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                E-posta
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
                Parola
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#003580] focus:outline-none focus:ring-1 focus:ring-[#003580]"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#003580] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#002b66] disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {submitting ? "Giriş yapılıyor..." : "Giriş Yap"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            Hesabınız yok mu?{" "}
            <Link href="/register" className="font-semibold text-[#003580] hover:underline">
              Kayıt Ol
            </Link>
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
