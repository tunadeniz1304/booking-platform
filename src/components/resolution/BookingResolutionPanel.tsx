"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { LoadError, focusRing, useLoader } from "@/components/ui/ui";
import ClaimList from "./ClaimList";
import OpenClaimForm from "./OpenClaimForm";
import OpenClaimSummaryCard from "./OpenClaimSummaryCard";
import { ACTIVE_STATUSES, DepositSummary, type ClaimSummary, type DepositView } from "./shared";

interface DepositResponse {
  deposit: DepositView | null;
  expectedMinor: number | null;
  /** Misafirin iade edilebilir üst sınırı; ev sahibi/yöneticiye `null` (F599). */
  refundableMinor?: number | null;
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
  // Depozito ve talepler ayrı yüklenir: biri başarısız olursa diğeri yine gösterilir; her hata
  // kendi bölümünde "Tekrar dene" ile çıkar (F945).
  const depositLoader = useLoader(
    () => apiFetch<DepositResponse>(`/api/bookings/${encodeURIComponent(bookingId)}/deposit`),
    [bookingId]
  );
  const claimsLoader = useLoader(
    () =>
      apiFetch<{ claims: ClaimSummary[] }>(
        `/api/claims?bookingId=${encodeURIComponent(bookingId)}`
      ),
    [bookingId]
  );
  const deposit = depositLoader.data;
  const claimsRes = claimsLoader.data;
  const depositPending = !deposit && !depositLoader.error;
  const claimsPending = !claimsRes && !claimsLoader.error;
  const loading = depositPending || claimsPending;
  // Bu oturumda açılan talep: özet kartı başarı metnini gösterir ve odağı "Kanıt ekle"ye taşır.
  const [createdId, setCreatedId] = useState<string | null>(null);
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
      {depositPending ? (
        <div aria-hidden="true" className="space-y-2">
          <div className={`h-6 w-40 ${skeletonBlock}`} />
          <div className={`h-28 ${skeletonBlock}`} />
        </div>
      ) : (
        <div>
          <h3 className="mb-2 text-base font-semibold text-gray-900">{t("deposit.title")}</h3>
          {deposit && (
            <DepositSummary
              deposit={deposit.deposit}
              expectedMinor={deposit.expectedMinor}
              currency={deposit.currency}
              viewerRole={deposit.role}
            />
          )}
          {depositLoader.error && (
            <div className={deposit ? "mt-2" : undefined}>
              <LoadError
                error={depositLoader.error}
                onRetry={depositLoader.reload}
                busy={depositLoader.loading}
              />
            </div>
          )}
        </div>
      )}
      {claimsPending ? (
        <div aria-hidden="true" className="space-y-2">
          <div className={`h-6 w-56 ${skeletonBlock}`} />
          <div className={`h-16 ${skeletonBlock}`} />
        </div>
      ) : (
        <div>
          <h3 className="mb-2 text-base font-semibold text-gray-900">{t("panel.claimsTitle")}</h3>
          {claimsRes &&
            (claimsRes.claims.length === 0 ? (
              <p className="text-sm text-gray-700">{t("panel.noClaims")}</p>
            ) : (
              <ClaimList claims={claimsRes.claims} />
            ))}
          {claimsLoader.error && (
            <div className={claimsRes ? "mt-2" : undefined}>
              <LoadError
                error={claimsLoader.error}
                onRetry={claimsLoader.reload}
                busy={claimsLoader.loading}
              />
            </div>
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
          <OpenClaimSummaryCard claim={openOwnClaim} justCreated={openOwnClaim.id === createdId} />
        ) : claimsPending ? null : (
          // Talepler yüklenemediyse form yine gösterilir; ikinci açık talebi sunucu reddeder.
          <OpenClaimForm
            bookingId={bookingId}
            role={deposit.role}
            currency={deposit.currency}
            maxMinor={deposit.refundableMinor ?? undefined}
            depositMinor={deposit.deposit ? deposit.deposit.amountMinor : deposit.expectedMinor}
            onCreated={(c) => {
              setCreatedId(c.id);
              depositLoader.reload();
              claimsLoader.reload();
            }}
          />
        ))}
    </section>
  );
}
