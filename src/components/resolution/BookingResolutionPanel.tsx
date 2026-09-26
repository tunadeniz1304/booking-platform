"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Status, focusRing, useLoader } from "@/components/ui/ui";
import ClaimList from "./ClaimList";
import OpenClaimForm from "./OpenClaimForm";
import { DepositSummary, type ClaimSummary, type DepositView } from "./shared";

interface DepositResponse {
  deposit: DepositView | null;
  expectedMinor: number | null;
  currency: string;
  role: "GUEST" | "HOST" | "ADMIN";
}

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

  return (
    <section
      aria-labelledby="resolution-panel-title"
      className="space-y-5 border-t border-gray-100 pt-6"
    >
      <h2 id="resolution-panel-title" className="text-lg font-semibold text-gray-900">
        {t("panel.title")}
      </h2>
      <Status error={error} />
      {!data && !error && (
        <p aria-live="polite" className="text-sm text-gray-600">
          {t("loading")}
        </p>
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
          <p className="text-sm text-gray-700">{t("open.adminInfo")}</p>
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
