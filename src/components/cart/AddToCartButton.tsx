"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { ErrorText, loginHref, useErrorText, useSession } from "@/components/ui/ui";
import { setHeaderCartCount } from "@/components/layout/useHeaderCartCount";

/** Girişten dönüşte tamamlanacak bekleyen eylem (sorgu parametresi). */
const INTENT = "add-to-cart";

type Status = { kind: "ok" | "error"; text: string; key: string };

interface Props {
  propertyId: string;
  roomTypeId?: string;
  ratePlanId?: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  /** Çocuk sayısı (varsayılan 0); misafir toplamı = adults + childCount. */
  childCount?: number;
  disabled?: boolean;
  /** Düğmenin neden etkin olmadığını anlatan öğenin id'si; aria-describedby'a eklenir. */
  describedBy?: string;
}

/**
 * İlan sayfasından grup sepetine ekleme (P1-1). Kalem sunucuda teklif motoruyla fiyatlanır;
 * oturum yoksa girişe yönlendirilir; dönüş adresi seçimleri (tarih, misafir, oda, plan) ve
 * bekleyen "sepete ekle" niyetini taşır, dönüşte ekleme kendiliğinden tamamlanır.
 * Eklenen seçim (oda, plan, tarih, misafir) için düğme "Sepete git" bağlantısına döner;
 * seçim değişince sonuç mesajı da düğme de yeni seçime göre sıfırlanır.
 */
export default function AddToCartButton({
  propertyId,
  roomTypeId,
  ratePlanId,
  checkIn,
  checkOut,
  adults,
  childCount,
  disabled,
  describedBy,
}: Props) {
  const t = useTranslations("cart");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const errorText = useErrorText();
  const session = useSession();
  const signedOut = session.status === "ready" && session.user === null;
  const pendingIntent = useRef<boolean | null>(null);
  const hintId = useId();
  const okId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cartLinkRef = useRef<HTMLAnchorElement>(null);
  const focusCartLink = useRef(false);
  const kids = childCount ?? 0;

  // Sonuç yalnız üretildiği seçime aittir; seçim değişince bayat mesaj gösterilmez (F1026).
  const key = [roomTypeId, ratePlanId, checkIn, checkOut, adults, kids].join("|");
  const current = status?.key === key ? status : null;
  const inCart = current?.kind === "ok";

  /** Geçerli sayfa + seçimler (+ isteğe bağlı bekleyen niyet) — girişten dönüş adresi. */
  function returnUrl(withIntent: boolean): string {
    const params = new URLSearchParams(window.location.search);
    params.set("checkIn", checkIn);
    params.set("checkOut", checkOut);
    params.set("guests", String(adults + kids));
    // Yetişkin/çocuk ayrımı yalnız çağıran bunu bildiriyorsa adrese yazılır (bayat kalmasın).
    if (childCount !== undefined) {
      params.set("adults", String(adults));
      params.set("children", String(kids));
    }
    if (roomTypeId) params.set("roomId", roomTypeId);
    if (ratePlanId) params.set("ratePlanId", ratePlanId);
    else params.delete("ratePlanId");
    if (withIntent) params.set("intent", INTENT);
    else params.delete("intent");
    return `${window.location.pathname}?${params.toString()}`;
  }

  async function add() {
    if (disabled || !roomTypeId || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await apiFetch<{ cart: { items: unknown[] } | null }>("/api/cart/items", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          roomTypeId,
          ...(ratePlanId ? { ratePlanId } : {}),
          checkIn,
          checkOut,
          adults,
          children: kids,
          quantity: 1,
        }),
      });
      // Başlıktaki sepet rozeti aynı sayfada güncel kalır.
      if (res.cart) setHeaderCartCount(res.cart.items.length);
      // Odak düğmedeyse, düğmenin yerini alan "Sepete git" bağlantısına taşınır (F582).
      focusCartLink.current = document.activeElement === buttonRef.current;
      setStatus({ kind: "ok", text: t("add.added"), key });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(loginHref(returnUrl(true)));
        return;
      }
      setStatus({
        kind: "error",
        text: err instanceof ApiError ? errorText(err) : t("add.failed"),
        key,
      });
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!inCart || !focusCartLink.current) return;
    focusCartLink.current = false;
    cartLinkRef.current?.focus();
  }, [inCart]);

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
      {inCart ? (
        <Link
          ref={cartLinkRef}
          href="/cart"
          aria-describedby={okId}
          data-testid="add-to-cart-go"
          className="block w-full rounded-lg border border-[#003580] px-4 py-3 text-center text-sm font-semibold text-[#003580] transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2"
        >
          {t("add.goToCart")}
        </Link>
      ) : (
        // `disabled` yerine aria-disabled: düğme odaklanabilir kalır, nedeni okunur (F582, F1010).
        <button
          ref={buttonRef}
          type="button"
          onClick={() => void add()}
          aria-disabled={disabled || busy || !roomTypeId || undefined}
          aria-busy={busy || undefined}
          aria-describedby={describedBy ? `${describedBy} ${hintId}` : hintId}
          data-testid="add-to-cart"
          className="w-full rounded-lg border border-[#003580] px-4 py-3 text-sm font-semibold text-[#003580] transition hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003580] focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:border-gray-300 aria-disabled:text-gray-500"
        >
          {busy ? t("add.adding") : t("add.button")}
        </button>
      )}
      <p id={hintId} className="mt-1 text-xs text-gray-500">
        {t("add.hint")}
        {signedOut && !inCart && <> {t("add.loginHint")}</>}
      </p>
      {/* F1396: başarı role=status, hata role=alert; ikisi de DOM'da sürekli durur. */}
      <div role="status">
        {inCart && (
          <p id={okId} className="mt-2 text-sm text-green-700">
            {current?.text}
          </p>
        )}
      </div>
      <div role="alert">
        {/* F2-44: kalıcı alert bölgesi korunur; içerik ortak ErrorText (rolsüz). */}
        {current?.kind === "error" && (
          <ErrorText live={false} className="mt-2">
            {current.text}
          </ErrorText>
        )}
      </div>
    </div>
  );
}
