"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { fetchCurrentUser, type SessionUser } from "@/lib/api-client";

/** Ortak odak halkası (klavye kullanıcıları için görünür). */
export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2";

export const inputClass = `mt-1 block w-full rounded-md border border-gray-400 bg-white px-3 py-2 text-sm text-gray-900 ${focusRing}`;

const buttonVariants = {
  primary: "bg-[#003580] text-white hover:bg-[#002b66]",
  secondary: "border border-[#003580] bg-white text-[#003580] hover:bg-blue-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
} as const;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariants[variant]} ${focusRing} ${className}`}
    />
  );
}

export function Field({
  label,
  id,
  hint,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-600">{hint}</p>}
    </div>
  );
}

export function Card({
  title,
  children,
  id,
}: {
  title?: string;
  children: ReactNode;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      {title && (
        <h2 id={headingId} className="mb-3 text-lg font-semibold text-gray-900">
          {title}
        </h2>
      )}
      {children}
    </section>
  );
}

const MODE_LABEL: Record<string, string> = {
  live: "Canlı LLM",
  demo: "Demo (deterministik)",
  fallback: "Yedek (LLM başarısız)",
};

/** LLM çalışma modu rozeti (P2-2: kullanıcı yapay zekâ çıktısını ayırt edebilmeli). */
export function LlmBadge({ mode }: { mode?: string | null }) {
  if (!mode) return null;
  const color =
    mode === "live"
      ? "bg-green-100 text-green-900"
      : mode === "fallback"
        ? "bg-amber-100 text-amber-900"
        : "bg-gray-200 text-gray-900";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
      title="Yapay zekâ çıktısı — doğruluğunu kontrol edin"
    >
      YZ: {MODE_LABEL[mode] ?? mode}
    </span>
  );
}

/** Asenkron sonuçlar için ekran okuyucu dostu durum alanı. */
export function Status({ error, message }: { error?: string | null; message?: string | null }) {
  return (
    <div aria-live="polite" className="min-h-[1.25rem] text-sm">
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!error && message && <p className="text-green-800">{message}</p>}
    </div>
  );
}

export function PageShell({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {intro && <div className="mt-1 text-sm text-gray-700">{intro}</div>}
        </div>
        {children}
      </main>
      <Footer />
    </div>
  );
}

type SessionState = { status: "loading" } | { status: "ready"; user: SessionUser | null };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    fetchCurrentUser().then((user) => {
      if (active) setState({ status: "ready", user });
    });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

/** Rol kapısı: oturum yoksa giriş bağlantısı, rol yetmiyorsa açık mesaj (API ayrıca yetkilendirir). */
export function RoleGate({
  roles,
  children,
}: {
  roles?: ReadonlyArray<SessionUser["role"]>;
  children: (user: SessionUser) => ReactNode;
}) {
  const session = useSession();
  if (session.status === "loading") {
    return (
      <p aria-live="polite" className="text-sm text-gray-600">
        Yükleniyor…
      </p>
    );
  }
  if (!session.user) {
    return (
      <p className="text-sm text-gray-800">
        Bu sayfa için{" "}
        <Link href="/login" className={`font-semibold text-[#003580] underline ${focusRing}`}>
          giriş yapın
        </Link>
        .
      </p>
    );
  }
  if (roles && !roles.includes(session.user.role)) {
    return (
      <p role="alert" className="text-sm text-red-700">
        Bu sayfaya erişim yetkiniz yok ({roles.join(" / ")} rolü gerekir).
      </p>
    );
  }
  return <>{children(session.user)}</>;
}

/**
 * Basit veri yükleyici: `fetcher` bir Promise döner; `reload()` yeniden çeker.
 * setState yalnızca Promise geri çağrısında yapılır (effect gövdesinde değil).
 */
export function useLoader<T>(fetcher: () => Promise<T>, deps: ReadonlyArray<unknown> = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    fetcher()
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps çağıran tarafından verilir
  }, [version, ...deps]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu";
}
