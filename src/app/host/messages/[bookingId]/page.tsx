"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import BookingMessages from "@/components/booking/BookingMessages";
import BookingResolutionPanel from "@/components/resolution/BookingResolutionPanel";
import { RoleGate, focusRing } from "@/components/ui/ui";

/**
 * Ev sahibi görünümü: rezervasyon yazışması ve bu rezervasyon için depozito /
 * hasar talebi paneli (yetki sunucuda; host değilse 404).
 */
export default function HostMessagesPage() {
  const t = useTranslations("host");
  const { bookingId } = useParams<{ bookingId: string }>();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link
          href="/host"
          className={`inline-flex items-center gap-1 py-2 text-sm font-semibold text-[#003580] hover:underline ${focusRing}`}
        >
          <span aria-hidden="true">←</span>
          {t("messagesPage.back")}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">{t("messagesPage.title")}</h1>
        <p className="mt-1 text-sm text-gray-700">{t("messagesPage.intro")}</p>
        <RoleGate roles={["HOST"]}>
          {() =>
            bookingId ? (
              <div className="mt-4 space-y-6 rounded-2xl bg-white p-4 shadow-sm sm:p-8">
                <BookingMessages bookingId={bookingId} divider={false} />
                <BookingResolutionPanel bookingId={bookingId} />
              </div>
            ) : null
          }
        </RoleGate>
      </main>
      <Footer />
    </div>
  );
}
