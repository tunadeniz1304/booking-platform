"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { getToken, logout } from "@/lib/api-client";

const navItems = [
  { label: "Konaklama", href: "/" },
  { label: "Uçuş", href: "/", disabled: true },
  { label: "Araç Kiralama", href: "/", disabled: true },
  { label: "Turistik Yerler", href: "/", disabled: true },
  { label: "Havalimanı Taksi", href: "/", disabled: true },
];

interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (!getToken()) {
      setUser(null);
      return;
    }
    fetch("/api/user/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setUser(data))
      .catch(() => setUser(null));
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
    setUser(null);
    router.push("/");
    router.refresh();
  };

  const initials = user
    ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
    : "";

  return (
    <header className="bg-[#003580] text-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-2xl font-bold tracking-tight">
            booking<span className="text-[#febb02]">.com</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Ana menü">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-disabled={item.disabled}
                className={`rounded-sm px-3 py-2 text-sm font-medium transition hover:bg-white/10 hover:text-white ${
                  item.disabled ? "cursor-not-allowed text-white/50 hover:bg-transparent" : "text-white/90"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {hydrated && user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-medium text-white/90 transition hover:bg-white/10"
                aria-label="Hesabım"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-bold text-[#003580]">
                  {initials}
                </span>
                <span className="hidden sm:inline">{user.firstName}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="hidden rounded-sm border border-white/30 px-3 py-1.5 text-sm font-medium text-white/90 transition hover:bg-white/10 sm:block"
              >
                Çıkış
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/register"
                className="hidden rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:block"
              >
                Kayıt Ol
              </Link>
              <Link
                href="/login"
                className="hidden rounded-sm bg-white px-4 py-2 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 sm:block"
              >
                Giriş Yap
              </Link>
            </div>
          )}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="rounded-sm p-2 text-white transition hover:bg-white/10 lg:hidden"
            aria-label="Menüyü aç/kapat"
            aria-expanded={isMenuOpen}
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              {isMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <div className="border-t border-white/10 bg-[#003580] px-4 pb-4 pt-2 lg:hidden">
          <nav className="flex flex-col gap-1" aria-label="Mobil menü">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                aria-disabled={item.disabled}
                className={`rounded-sm px-3 py-2 text-sm font-medium transition hover:bg-white/10 ${
                  item.disabled ? "text-white/50" : "text-white/90 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2">
              {hydrated && user ? (
                <button
                  onClick={handleLogout}
                  className="rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580]"
                >
                  Çıkış Yap
                </button>
              ) : (
                <>
                  <Link
                    href="/register"
                    className="rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580]"
                  >
                    Kayıt Ol
                  </Link>
                  <Link
                    href="/login"
                    className="rounded-sm bg-white px-4 py-2 text-center text-sm font-semibold text-[#003580]"
                  >
                    Giriş Yap
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
