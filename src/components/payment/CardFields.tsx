"use client";

import { useId, type Ref } from "react";
import { useTranslations } from "next-intl";
import {
  CardValidationError,
  TEST_CARDS,
  tokenizeCard,
  type CardValidationCode,
} from "@/lib/payment/card-token";
import { Field, inputClass } from "@/components/ui/ui";

export type CardField = "number" | "exp" | "cvc";
/** Kontrollü kart değerleri; `exp` "AA/YY" biçimindedir. */
export type CardValues = Record<CardField, string>;
export type CardFieldErrors = Partial<Record<CardField, string | null | undefined>>;

/** Kart doğrulama kodu → ilgili alan. */
export const CARD_ERROR_FIELD: Record<CardValidationCode, CardField> = {
  CARD_NUMBER_INVALID: "number",
  CVC_INVALID: "cvc",
  CARD_EXPIRED: "exp",
};

/** "1230", "12/30", "12-30", "12 / 2030" → { mm, yyyy }; geçersizse null. */
export function parseExpiry(value: string): { mm: number; yyyy: number } | null {
  const m = /^\s*(\d{1,2})\s*[/\-. ]?\s*(\d{2}|\d{4})\s*$/.exec(value);
  if (!m) return null;
  const mm = Number(m[1]);
  const yy = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return { mm, yyyy: m[2].length === 4 ? yy : 2000 + yy };
}

/** Yazarken AA/YY biçimine getirir (otomatik "/"). */
export function formatExpiry(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** Alanın input id'si (`${idPrefix}-number` / `-exp` / `-cvc`); odaklamak için. */
export function cardFieldId(idPrefix: string, field: CardField): string {
  return `${idPrefix}-${field}`;
}

/** Hata: `messageKey` `payment` ad alanında bir anahtardır; `field` null ise genel hata. */
export type CardTokenResult =
  | { ok: true; cardToken: string }
  | {
      ok: false;
      field: CardField | null;
      messageKey: "errors.EXPIRY_FORMAT" | `errors.${CardValidationCode}` | "invalidCard";
    };

/** Son kullanmayı `parseExpiry` ile ayrıştırıp kartı token'a çevirir (`split("/")` yok). */
export function tokenizeCardFields(values: CardValues, now?: Date): CardTokenResult {
  const exp = parseExpiry(values.exp);
  if (!exp) return { ok: false, field: "exp", messageKey: "errors.EXPIRY_FORMAT" };
  try {
    const cardToken = tokenizeCard(
      { number: values.number, expMonth: exp.mm, expYear: exp.yyyy, cvc: values.cvc },
      now
    );
    return { ok: true, cardToken };
  } catch (err) {
    const code = err instanceof CardValidationError ? err.code : undefined;
    if (code) return { ok: false, field: CARD_ERROR_FIELD[code], messageKey: `errors.${code}` };
    return { ok: false, field: null, messageKey: "invalidCard" };
  }
}

export interface CardFieldsProps {
  /** Kontrollü değerler. */
  values: CardValues;
  /** Alan değişince; `exp` değeri `formatExpiry` ile biçimlenmiş gelir. */
  onChange: (field: CardField, value: string) => void;
  /** Alan hataları (`Field` ile `aria-invalid` + `aria-describedby` bağlanır). */
  errors?: CardFieldErrors;
  /** Düzenlemeyi kapatır: `readOnly` + `aria-disabled` (`disabled` odağı düşürürdü). */
  disabled?: boolean;
  /** Input id öneki; verilmezse `useId()`. Bkz. `cardFieldId`. */
  idPrefix?: string;
  /** Kart numarası altındaki ipucu. */
  numberHint?: string;
  /** Alanların altına `payment.testCards` demo kartları metnini ekler. */
  showTestCards?: boolean;
  /** Hata alanına odaklanmak için input ref'leri. */
  inputRefs?: Partial<Record<CardField, Ref<HTMLInputElement>>>;
  /** Sarmalayıcıya eklenecek sınıflar (varsayılan `space-y-3` korunur). */
  className?: string;
}

/**
 * Mock kart alanları (numara, son kullanma AA/YY, CVC). Etiketler `payment` ad alanından gelir;
 * e2e testleri "Kart numarası" / "Son kullanma (AA/YY)" / "CVC" etiketlerini hedefler.
 *
 * ```tsx
 * <CardFields values={card} onChange={(k, v) => setCard((c) => ({ ...c, [k]: v }))}
 *   errors={fieldErrors} idPrefix={ids} showTestCards />
 * const r = tokenizeCardFields(card);
 * if (!r.ok) setFieldErrors(r.field ? { [r.field]: tp(r.messageKey) } : {});
 * ```
 */
export function CardFields({
  values,
  onChange,
  errors,
  disabled = false,
  idPrefix,
  numberHint,
  showTestCards = false,
  inputRefs,
  className = "",
}: CardFieldsProps) {
  const t = useTranslations("payment");
  const autoId = useId();
  const prefix = idPrefix ?? autoId;
  const ids = {
    number: cardFieldId(prefix, "number"),
    exp: cardFieldId(prefix, "exp"),
    cvc: cardFieldId(prefix, "cvc"),
  };
  const common = {
    className: `${inputClass} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`,
    inputMode: "numeric" as const,
    readOnly: disabled || undefined,
    "aria-disabled": disabled || undefined,
    required: true,
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <Field label={t("cardNumber")} id={ids.number} hint={numberHint} error={errors?.number}>
        <input
          {...common}
          id={ids.number}
          ref={inputRefs?.number}
          autoComplete="cc-number"
          maxLength={23}
          value={values.number}
          onChange={(e) => onChange("number", e.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("expiry")} id={ids.exp} hint={t("expiryHint")} error={errors?.exp}>
          <input
            {...common}
            id={ids.exp}
            ref={inputRefs?.exp}
            autoComplete="cc-exp"
            maxLength={5}
            value={values.exp}
            onChange={(e) => onChange("exp", formatExpiry(e.target.value))}
          />
        </Field>
        <Field label={t("cvc")} id={ids.cvc} error={errors?.cvc}>
          <input
            {...common}
            id={ids.cvc}
            ref={inputRefs?.cvc}
            autoComplete="cc-csc"
            maxLength={4}
            value={values.cvc}
            onChange={(e) => onChange("cvc", e.target.value)}
          />
        </Field>
      </div>
      {showTestCards && (
        <p className="text-xs text-gray-500">
          {t("testCards", {
            success: TEST_CARDS.success,
            decline: TEST_CARDS.decline,
            threeDs: TEST_CARDS.threeDs,
          })}
        </p>
      )}
    </div>
  );
}

export default CardFields;
