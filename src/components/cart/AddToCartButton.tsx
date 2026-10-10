"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { loginHref, useErrorText, useSession } from "@/components/ui/ui";

/** Girişten dönüşte tamamlanacak bekleyen eylem (sorgu parametresi). */
const INTENT = "add-to-cart";

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
 * oturum yoksa girişe yönlendirilir; dönüş adresi seçimleri (tarih, misafir, oda, plan) ve
 * bekleyen "sepete ekle" niyetini taşır, dönüşte ekleme kendiliğinden tamamlanır.
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
  const errorText = useErrorText();
  const session = useSession();
  const signedOut = session.status === "ready" && session.user === null;
  const pendingIntent = useRef<boolean | null>(null);

  /** Geçerli sayfa + seçimler (+ isteğe bağlı bekleyen niyet) — girişten dönüş adresi. */
  function returnUrl(withIntent: boolean): string {
    const params = new URLSearchParams(window.location.search);
    params.set("checkIn", checkIn);
    params.set("checkOut", checkOut);
    params.set("guests", String(adults));
    if (roomTypeId) params.set("roomId", roomTypeId);
    if (ratePlanId) params.set("ratePlanId", ratePlanId);
    else params.delete("ratePlanId");
    if (withIntent) params.set("intent", INTENT);
    else params.delete("intent");
    return `${window.location.pathname}?${params.toString()}`;
  }

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
        router.push(loginHref(returnUrl(true)));
        return;
      }
      setStatus({
        kind: "error",
        text: err instanceof ApiError ? errorText(err) : t("add.failed"),
      });
    } finally {
      setBusy(false);
    }
  }

  // Girişten dönüş: bekleyen "sepete ekle" niyeti, teklif hazır olunca bir kez tamamlanır.
  useEffect(() => {
    if (pendingIntent.current === null) {
      pendingIntent.current = new URLSearchParams(window.location.search).get("intent") === INTENT;
    }
    if (!pendingIntent.current || disabled || !roomTypeId) return;
    pendingIntent.current = false;
    window.history.replaceState(window.history.state, "", returnUrl(false));
    void add();
    // add/returnUrl her çizimde yeni; niyet yalnız hazır olunca bir kez tetiklenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, roomTypeId]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={add}
        disabled={disabled || busy || !roomTypeId}
        aria-busy={busy || undefined}
        aria-describedby="add-to-cart-hint"
        data-testid="add-to-cart"
        className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-500"
      >
        {busy ? t("add.adding") : t("add.button")}
      </button>
      <p id="add-to-cart-hint" className="mt-1 text-xs text-gray-500">
        {t("add.hint")}
        {signedOut && <> {t("add.loginHint")}</>}
      </p>
      <div aria-live="polite">
        {status?.kind === "ok" && (
          <p className="mt-2 text-sm text-green-700">
            {status.text}{" "}
            <Link href="/cart" className="font-semibold underline">
              {t("add.goToCart")}
            </Link>
          </p>
        )}
        {status?.kind === "error" && <p className="mt-2 text-sm text-red-600">{status.text}</p>}
      </div>
    </div>
  );
}
