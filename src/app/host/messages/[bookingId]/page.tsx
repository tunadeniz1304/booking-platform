"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import BookingMessages from "@/components/booking/BookingMessages";
import BookingResolutionPanel from "@/components/resolution/BookingResolutionPanel";
import { PageShell, RoleGate, focusRing } from "@/components/ui/ui";

/**
 * Ev sahibi görünümü: rezervasyon yazışması ve bu rezervasyon için depozito /
 * hasar talebi paneli (yetki sunucuda; host değilse 404). Yazışma yalnız misafir ile ilanın
 * ev sahibi arasındadır; ADMIN'e API 404 döndüğü için kapı yalnız HOST'a açılır.
 * Rezervasyon bağlamı (ilan, tarihler, misafir, durum) yazışma yanıtından gösterilir.
 */
export default function HostMessagesPage() {
  const t = useTranslations("host");
  const { bookingId } = useParams<{ bookingId: string }>();
  return (
    <PageShell
      title={t("messagesPage.title")}
      intro={
        <>
          <p>{t("messagesPage.intro")}</p>
          {/* Panelin başına değil rezervasyon kartına döner; kart yüklenirken de var (F1266). */}
          <Link
            href="/host#host-bookings"
            className={`mt-1 inline-flex items-center gap-1 py-2 font-semibold text-[#003580] hover:underline ${focusRing}`}
          >
            <span aria-hidden="true">←</span>
            {t("messagesPage.back")}
          </Link>
        </>
      }
    >
      <RoleGate roles={["HOST"]}>
        {() =>
          bookingId ? (
            <div className="max-w-3xl space-y-6 rounded-2xl bg-white p-4 shadow-sm sm:p-8">
              <BookingMessages bookingId={bookingId} divider={false} showContext />
              <BookingResolutionPanel bookingId={bookingId} />
            </div>
          ) : null
        }
      </RoleGate>
    </PageShell>
  );
}
