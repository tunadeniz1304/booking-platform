"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Status, focusRing, useLoader } from "@/components/ui/ui";
import ClaimList from "./ClaimList";
import OpenClaimForm from "./OpenClaimForm";
import { ACTIVE_STATUSES, DepositSummary, type ClaimSummary, type DepositView } from "./shared";

interface DepositResponse {
  deposit: DepositView | null;
  expectedMinor: number | null;
  currency: string;
  role: "GUEST" | "HOST" | "ADMIN";
}

/** Panel başlığının kimliği; sayfa içi "Sorun bildir" bağlantıları buna yönelir (F1346). */
export const RESOLUTION_PANEL_TITLE_ID = "resolution-panel-title";

/**
 * Canlı bölge önce boş eklenir, metin sonradan yazılır ki ekran okuyucu duyursun; hızlı
 * yanıtta duyuru yapılmaz (F1347).
 */
const LOADING_ANNOUNCE_DELAY_MS = 400;

const skeletonBlock = "rounded-md bg-gray-100 motion-safe:animate-pulse";

/**
 * Rezervasyon sayfasındaki "Hasar depozitosu ve çözüm merkezi" bölümü (P1-5):
 * depozito durumu, bu rezervasyonun talepleri ve role göre talep açma formu.
 */
export default function BookingResolutionPanel({ bookingId }: { bookingId: string }) {
  const t = useTranslations("resolution");
  const { data, error, reload } = useLoader(
    () =>
      Promise.all([
        apiFetch<DepositResponse>(`/api/bookings/${encodeURIComponent(bookingId)}/deposit`),
        apiFetch<{ claims: ClaimSummary[] }>(
          `/api/claims?bookingId=${encodeURIComponent(bookingId)}`
        ),
      ]),
    [bookingId]
  );
  const [deposit, claimsRes] = data ?? [null, null];
  const loading = !data && !error;
  const [announceLoading, setAnnounceLoading] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnounceLoading(true), LOADING_ANNOUNCE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  // Başlık role göre misafirin/ev sahibinin görevini adlandırır (F1346).
  const title =
    deposit?.role === "GUEST"
      ? t("panel.titleGuest")
      : deposit?.role === "HOST"
        ? t("panel.titleHost")
        : t("panel.title");
  // Sunucu aynı rezervasyonda ikinci açık talebi reddeder (CLAIM_ALREADY_OPEN); formu
  // göstermek yerine açık talebe yönlendir.
  const openOwnClaim =
    claimsRes?.claims.find((c) => c.role === "OPENER" && ACTIVE_STATUSES.includes(c.status)) ??
    null;

  return (
    <section
      aria-labelledby={RESOLUTION_PANEL_TITLE_ID}
      className="space-y-5 border-t border-gray-100 pt-6"
    >
      <h2
        id={RESOLUTION_PANEL_TITLE_ID}
        className="scroll-mt-24 text-lg font-semibold text-gray-900"
      >
        {title}
      </h2>
      {/* Her zaman DOM'da; sr-only olduğu için hata/yükleme yokken boşluk bırakmaz (F1135). */}
      <p role="status" className="sr-only">
        {loading && announceLoading ? t("panel.loading") : null}
      </p>
      {error && <Status error={error} />}
      {loading && (
        <div aria-hidden="true" className="space-y-5">
          <div className="space-y-2">
            <div className={`h-6 w-40 ${skeletonBlock}`} />
            <div className={`h-28 ${skeletonBlock}`} />
          </div>
          <div className="space-y-2">
            <div className={`h-6 w-56 ${skeletonBlock}`} />
            <div className={`h-16 ${skeletonBlock}`} />
          </div>
        </div>
      )}
      {deposit && (
        <div>
          <h3 className="mb-2 text-base font-semibold text-gray-900">{t("deposit.title")}</h3>
          <DepositSummary
            deposit={deposit.deposit}
            expectedMinor={deposit.expectedMinor}
            currency={deposit.currency}
          />
        </div>
      )}
      {claimsRes && (
        <div>
          <h3 className="mb-2 text-base font-semibold text-gray-900">{t("panel.claimsTitle")}</h3>
          {claimsRes.claims.length === 0 ? (
            <p className="text-sm text-gray-700">{t("panel.noClaims")}</p>
          ) : (
            <ClaimList claims={claimsRes.claims} />
          )}
          <p className="mt-2 text-sm">
            <Link
              href="/resolution"
              className={`font-semibold text-[#003580] underline ${focusRing}`}
            >
              {t("panel.allClaims")}
            </Link>
          </p>
        </div>
      )}
      {deposit &&
        (deposit.role === "ADMIN" ? (
          <p className="text-sm text-gray-700">
            {t.rich("open.adminInfo", {
              link: (chunks) => (
                <Link
                  href="/admin/claims"
                  className={`font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
        ) : openOwnClaim ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-700">{t("open.alreadyOpen")}</p>
            <p className="text-sm">
              <Link
                href={`/resolution/${encodeURIComponent(openOwnClaim.id)}`}
                className={`font-semibold text-[#003580] underline ${focusRing}`}
              >
                {t("open.viewOpen")}
              </Link>
            </p>
          </div>
        ) : (
          <OpenClaimForm
            bookingId={bookingId}
            role={deposit.role}
            currency={deposit.currency}
            onCreated={reload}
          />
        ))}
    </section>
  );
}
