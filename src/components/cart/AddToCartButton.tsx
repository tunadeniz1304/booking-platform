"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";

interface Props {
  propertyId: string;
  roomTypeId?: string;
  ratePlanId?: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  disabled?: boolean;
}

/**
 * İlan sayfasından grup sepetine ekleme (P1-1). Kalem sunucuda teklif motoruyla fiyatlanır;
 * oturum yoksa girişe yönlendirilir ve dönüşte aynı sayfaya gelinir.
 */
export default function AddToCartButton({
  propertyId,
  roomTypeId,
  ratePlanId,
  checkIn,
  checkOut,
  adults,
  disabled,
}: Props) {
  const t = useTranslations("cart");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function add() {
    if (!roomTypeId) return;
    setBusy(true);
    setStatus(null);
    try {
      await apiFetch("/api/cart/items", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          roomTypeId,
          ...(ratePlanId ? { ratePlanId } : {}),
          checkIn,
          checkOut,
          adults,
          children: 0,
          quantity: 1,
        }),
      });
      setStatus({ kind: "ok", text: t("add.added") });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(
          `/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`
        );
        return;
      }
      setStatus({
        kind: "error",
        text: err instanceof ApiError ? err.message : t("add.failed"),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={add}
        disabled={disabled || busy || !roomTypeId}
        data-testid="add-to-cart"
        className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-500"
      >
        {busy ? t("add.adding") : t("add.button")}
      </button>
      <p className="mt-1 text-xs text-gray-500">{t("add.hint")}</p>
      <div aria-live="polite">
        {status?.kind === "ok" && (
          <p className="mt-2 text-sm text-green-700">
            {status.text}{" "}
            <Link href="/cart" className="font-semibold underline">
              {t("add.goToCart")}
            </Link>
          </p>
        )}
        {status?.kind === "error" && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {status.text}
          </p>
        )}
      </div>
    </div>
  );
}
