"use client";

import type { ReactNode, Ref } from "react";
import { useTranslations } from "next-intl";
import { Button, Field, inputClass } from "@/components/ui/ui";

/** Birincil düğmenin pasif / meşgul görünümü (mevcut gri renkler korunur). */
const PRIMARY_DISABLED =
  "aria-disabled:bg-gray-300 aria-disabled:text-gray-700 aria-disabled:opacity-100";

/**
 * 3D Secure kod formu (F2-31): sepet ödemesi ve bölünmüş ödeme payı aynı formu kullanır.
 * Kod alanı Field ile etiketli, yalnız rakam (en çok 6); "kod gelmedi" yardımı ve kart
 * formuna dönüş yolu her zaman görünür. Meşgulken düğmeler odakta kalır (aria-disabled).
 */
export function ThreeDsForm({
  idPrefix,
  headingRef,
  intro,
  code,
  onCodeChange,
  busy,
  onSubmit,
  onBack,
  noCodeText,
  className = "mt-6",
}: {
  idPrefix: string;
  headingRef?: Ref<HTMLHeadingElement>;
  intro: ReactNode;
  code: string;
  onCodeChange: (code: string) => void;
  busy: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  /** Varsayılan: payment.threeDsNoCode. */
  noCodeText?: string;
  className?: string;
}) {
  const tp = useTranslations("payment");
  const titleId = `${idPrefix}-3ds-title`;
  const codeId = `${idPrefix}-3ds-code`;
  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={`${className} space-y-3 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm`}
    >
      <h2
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-gray-900 focus:outline-none"
      >
        {tp("threeDsTitle")}
      </h2>
      <p className="text-sm text-gray-600">{intro}</p>
      <Field label={tp("verificationCode")} id={codeId}>
        <input
          id={codeId}
          className={inputClass}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, ""))}
          required
        />
      </Field>
      <Button type="submit" busy={busy} size="lg" fullWidth className={PRIMARY_DISABLED}>
        {busy ? tp("processing") : tp("verify")}
      </Button>
      <p className="text-sm text-gray-600">{noCodeText ?? tp("threeDsNoCode")}</p>
      <Button
        variant="secondary"
        fullWidth
        className="min-h-[44px]"
        aria-disabled={busy || undefined}
        onClick={() => {
          if (!busy) onBack();
        }}
      >
        {tp("threeDsBack")}
      </Button>
    </form>
  );
}
