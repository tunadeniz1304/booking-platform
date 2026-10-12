"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { focusRing } from "@/components/ui/ui";

export interface SectionPagesNavItem {
  href: string;
  label: string;
}

/**
 * Bir bölümün (ev sahibi, yönetim, hesap) kardeş sayfaları arasında ikincil gezinme (F821).
 * Geçerli sayfa `aria-current="page"` ile işaretlenir; görsel olarak kalın alt çizgiyle ayrılır.
 */
export default function SectionPagesNav({
  label,
  items,
  className = "",
}: {
  /** Gezinme bölgesinin erişilebilir adı (ör. "Ev sahibi sayfaları"). */
  label: string;
  items: ReadonlyArray<SectionPagesNavItem>;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap gap-x-4">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={pathname === item.href ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] underline-offset-4 hover:underline aria-[current=page]:underline aria-[current=page]:decoration-2 sm:min-h-[24px] ${focusRing}`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
