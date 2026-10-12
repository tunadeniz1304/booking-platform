"use client";

import { type Ref, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";

interface CreditOptions {
  currency: string;
  availableMinor: number;
  maxUsableMinor: number;
  reservedMinor: number;
}

interface Props {
  bookingId: string;
  /** Rezervasyon toplamı (minor-unit): kartla ödenecek kalanı göstermek için. */
  totalMinor?: number;
  currency?: string;
  disabled?: boolean;
  /** Seçilen kredi (minor-unit; 0 = kullanma). */
  onChange: (creditMinor: number) => void;
  /**
   * Tutar geçerliliği değişince çağrılır (kredi kullanılmıyorsa geçerli). Geçersizken ebeveyn
   * ödemeyi göndermemeli; aksi halde kredi 0 sayılır ve tüm tutar karttan çekilir.
   */
  onValidityChange?: (valid: boolean) => void;
  /** Tutar alanı (ebeveyn geçersiz tutarda odağı buraya taşır). */
  inputRef?: Ref<HTMLInputElement>;
  /** "Sonra öde" seçili: kutu kaybolmaz; devre dışı görünür ve nedeni yazılır. */
  rnplSelected?: boolean;
  /** Seçenek okunduğunda bir kez çağrılır (`shown`: kutu görünüyor mu); yer ayırmak için. */
  onLoaded?: (shown: boolean) => void;
}

const inRange = (minor: number, max: number) =>
  Number.isInteger(minor) && minor >= 0 && minor <= max;

/**
 * Checkout ▸ "Krediyi kullan" (P1-7). Kredi yoksa ya da bu rezervasyonda kullanılamıyorsa
 * (sepet kalemi) hiç görünmez. Tutar sunucuda yeniden doğrulanır (asgari kart tutarı, bakiye).
 */
export default function WalletCreditOption({
  bookingId,
  totalMinor,
  currency,
  disabled,
  onChange,
  onValidityChange,
  inputRef,
  rnplSelected,
  onLoaded,
}: Props) {
  const t = useTranslations("wallet.checkout");
  const fmt = useFormat();
  const [opts, setOpts] = useState<CreditOptions | null>(null);
  const [use, setUse] = useState(false);
  const [amount, setAmount] = useState(0);
  /** Kullanıcının yazdığı metin ("1.250,50" gibi); tutar ondan ayrıştırılır. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Hata alan terk edilince gösterilir (her tuşta değil); yeniden yazınca kalkar. */
  const [showError, setShowError] = useState(false);
  /** Üst sınıra kırpılan tutarın bildirimi. */
  const [clampedTo, setClampedTo] = useState<number | null>(null);
  const uid = useId();
  const inputId = `${uid}-amount`;
  const hintId = `${uid}-hint`;
  const errorId = `${uid}-error`;
  const clampId = `${uid}-clamp`;
  const rnplNoteId = `${uid}-rnpl`;

  // Bileşen kaldırılınca (ör. "sonra öde" seçildi) ebeveyndeki kredi sıfırlanır; aksi halde
  // kutu yeniden boş görünürken eski kredi ödemeye eklenirdi (gizli durum).
  const onChangeRef = useRef(onChange);
  const onValidityRef = useRef(onValidityChange);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onChangeRef.current = onChange;
    onValidityRef.current = onValidityChange;
    onLoadedRef.current = onLoaded;
  }, [onChange, onValidityChange, onLoaded]);
  useEffect(
    () => () => {
      onChangeRef.current(0);
      onValidityRef.current?.(true);
    },
    []
  );

  useEffect(() => {
    let active = true;
    apiFetch<CreditOptions>(`/api/bookings/${bookingId}/credit`)
      .then((o) => {
        if (!active) return;
        setOpts(o);
        setAmount(o.reservedMinor > 0 ? o.reservedMinor : o.maxUsableMinor);
        onLoadedRef.current?.(o.maxUsableMinor > 0);
      })
      .catch(() => {
        // Kredi seçeneği okunamazsa yalnız kart.
        if (active) onLoadedRef.current?.(false);
      });
    return () => {
      active = false;
    };
  }, [bookingId]);

  const max = opts?.maxUsableMinor ?? 0;
  const valid = inRange(amount, max);
  const usable = max > 0 && use && !rnplSelected;
  useEffect(() => {
    onValidityRef.current?.(!usable || valid);
  }, [usable, valid]);

  if (!opts || max <= 0) return null;
  const cur = currency ?? opts.currency;
  const maxText = fmt.money(max, cur);
  const symbolPart = new Intl.NumberFormat(fmt.locale, { style: "currency", currency: cur })
    .formatToParts(0)
    .find((p) => p.type === "currency");
  const symbol = symbolPart?.value ?? cur;
  const amountText =
    draft ?? fmt.number(amount / 100, { maximumFractionDigits: 2, useGrouping: false });
  const errorShown = showError && !valid;

  const update = (nextUse: boolean, nextAmount: number) => {
    setUse(nextUse);
    setAmount(nextAmount);
    onChange(nextUse && inRange(nextAmount, max) ? nextAmount : 0);
  };

  // Geçerli tutar biçimlenir; üst sınırı aşan tutar sınıra kırpılır ve bildirilir; ayrıştırılamayan
  // metin olduğu gibi kalır ve hata gösterilir (sessizce 0'a düşmez).
  const onBlur = () => {
    const parsed = draft === null ? amount : parseAmountToMinor(draft);
    if (parsed !== null && parsed > max) {
      setDraft(null);
      setClampedTo(max);
      update(true, max);
    } else if (parsed !== null && parsed >= 0) {
      setDraft(null);
    } else {
      setShowError(true);
    }
  };

  const describedBy = [hintId, errorShown && errorId, clampedTo !== null && clampId]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset
      className="space-y-2 rounded-lg border border-gray-200 p-3"
      disabled={disabled || rnplSelected}
    >
      <legend className="px-1 text-sm font-semibold text-gray-900">{t("title")}</legend>
      <label className="flex min-h-[44px] items-center gap-2 text-sm text-gray-800 sm:min-h-0">
        <input
          type="checkbox"
          checked={use && !rnplSelected}
          onChange={(e) => update(e.target.checked, amount)}
          aria-describedby={rnplSelected ? rnplNoteId : undefined}
          className="h-4 w-4"
        />
        {t("use")}
        <span className="text-gray-500">
          {t("available", { amount: fmt.money(opts.availableMinor, cur) })}
        </span>
      </label>
      {rnplSelected ? (
        <p id={rnplNoteId} className="text-sm text-gray-600">
          {t("rnplUnavailable")}
        </p>
      ) : (
        use && (
          <div className="space-y-1">
            <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
              {t("amountWithCurrency", { currency: symbol })}
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => {
                setDraft(e.target.value);
                setShowError(false);
                setClampedTo(null);
                // Ayrıştırılamayan metin geçersizdir (-1); "1.250,50" ve "1250.5" kabul edilir.
                update(true, parseAmountToMinor(e.target.value) ?? -1);
              }}
              onBlur={onBlur}
              aria-invalid={errorShown || undefined}
              aria-describedby={describedBy}
              className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-500 px-3 py-2 text-sm sm:min-h-0"
            />
            <p id={hintId} className="text-xs text-gray-500">
              {t("max", { amount: maxText })}
            </p>
            {/* Sabit canlı bölge: hata/kırpma notu yazarken değil, alan terk edilince okunur. */}
            <div aria-live="polite">
              {errorShown && (
                <p id={errorId} className="text-xs text-red-700">
                  {t("invalid", { max: maxText })}
                </p>
              )}
              {clampedTo !== null && (
                <p id={clampId} className="text-xs text-gray-700">
                  {t("clamped", { max: fmt.money(clampedTo, cur) })}
                </p>
              )}
            </div>
            {valid && totalMinor !== undefined && (
              <p className="text-sm font-medium text-gray-900">
                {t("cardRemainder", { amount: fmt.money(totalMinor - amount, cur) })}
              </p>
            )}
            <p className="text-xs text-gray-500">{t("notice")}</p>
          </div>
        )
      )}
    </fieldset>
  );
}
