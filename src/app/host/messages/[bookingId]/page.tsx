"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import BookingMessages from "@/components/booking/BookingMessages";

/** Ev sahibi görünümü: rezervasyon yazışması (yetki sunucuda; host değilse 404). */
export default function HostMessagesPage() {
  const t = useTranslations("host");
  const { bookingId } = useParams<{ bookingId: string }>();
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <Header />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link href="/host" className="text-sm font-semibold text-[#003580] hover:underline">
          {t("messagesPage.back")}
        </Link>
        <div className="mt-4 rounded-2xl bg-white p-8 shadow-sm">
          {bookingId && <BookingMessages bookingId={bookingId} />}
        </div>
      </main>
      <Footer />
    </div>
  );
}
