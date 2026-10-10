"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { CONSENT_COOKIE } from "@/lib/privacy/consent";
import { Button, Card, Status, focusRing } from "@/components/ui/ui";
import { useAccountErrorText, useReauth } from "@/components/account/ReauthDialog";

/** `ACCOUNT_HAS_OBLIGATIONS` ayrıntısı (sunucu: privacy-service accountObligations). */
type Obligations = { hostedBookings?: number; pendingPayouts?: number; openClaims?: number };

const OBLIGATION_LINKS = [
  { key: "hostedBookings", href: "/host" },
  { key: "pendingPayouts", href: "/host/payouts" },
  { key: "openClaims", href: "/resolution" },
] as const;

function obligationsOf(err: unknown): Obligations | null {
  if (!(err instanceof ApiError) || err.code !== "ACCOUNT_HAS_OBLIGATIONS") return null;
  const d = err.details;
  if (!d || typeof d !== "object" || !("hostedBookings" in d)) return null;
  return d as Obligations;
}

/** KVKK self-servis (P2-5): veri dışa aktarımı ve hesap silme. */
export default function PrivacyCenter() {
  const t = useTranslations("privacy.center");
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [obligations, setObligations] = useState<Obligations | null>(null);
  const ackRef = useRef<HTMLInputElement>(null);
  const errorText = useAccountErrorText();
  // v4#2: hesap silme yakın zamanda yeniden doğrulama ister.
  const reauth = useReauth();

  async function download() {
    setFeedback({});
    try {
      const data = await apiFetch<unknown>("/api/account");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileName = t("exportFileName");
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback({ message: t("exported", { file: fileName }) });
    } catch (err) {
      setFeedback({ error: errorText(err, t("exportFailed")) });
    }
  }

  // Onay adımı açılınca odak onay kutusuna gelir.
  useEffect(() => {
    if (confirming) ackRef.current?.focus();
  }, [confirming]);

  async function remove() {
    if (busy || !acknowledged) return;
    setBusy(true);
    setFeedback({});
    setDeleteError(null);
    setObligations(null);
    try {
      await reauth.run(() => apiFetch("/api/account", { method: "DELETE" }));
      setFeedback({ message: t("deleted") });
      router.push("/");
      router.refresh();
    } catch (err) {
      // F193: hata silme kartının içinde; yükümlülük varsa nedenleri ve çözüm bağlantıları.
      const found = obligationsOf(err);
      setObligations(found);
      setDeleteError(found ? t("obligations.title") : errorText(err, t("deleteFailed")));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Status error={feedback.error} message={feedback.message} />
      <Card title={t("exportTitle")} id="export">
        <p className="mb-3 text-sm text-gray-800">{t("exportBody")}</p>
        <Button onClick={download}>{t("exportButton")}</Button>
      </Card>

      <Card title={t("deleteTitle")} id="delete">
        <p className="mb-2 text-sm text-gray-800">{t("deleteBody")}</p>
        {/* F20/F77: geri dönüşsüz sonuçlar onaydan önce açıkça söylenir. */}
        <p className="text-sm font-semibold text-gray-900">{t("deleteEffects.title")}</p>
        <ul className="mb-3 mt-1 list-disc space-y-1 pl-5 text-sm text-gray-800">
          <li>{t("deleteEffects.bookings")}</li>
          <li>{t("deleteEffects.wallet")}</li>
          <li>{t("deleteEffects.transfers")}</li>
          <li>{t("deleteEffects.listings")}</li>
          <li>{t("deleteEffects.obligations")}</li>
        </ul>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t("deleteButton")}
          </Button>
        ) : (
          <div
            role="group"
            aria-labelledby="delete-confirm-title"
            className="space-y-3 rounded-md border border-red-300 bg-red-50 p-3"
          >
            <p id="delete-confirm-title" className="text-sm font-semibold text-red-900">
              {t("confirmTitle")}
            </p>
            <div className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
              <input
                ref={ackRef}
                id="delete-ack"
                type="checkbox"
                className={`h-4 w-4 ${focusRing}`}
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <label htmlFor="delete-ack" className="text-sm text-gray-900">
                {t("acknowledge")}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={!acknowledged}
                busy={busy}
                className="min-h-[44px] sm:min-h-0"
                onClick={remove}
              >
                {busy ? t("deleting") : t("confirmDelete")}
              </Button>
              <Button
                variant="secondary"
                className="min-h-[44px] sm:min-h-0"
                onClick={() => {
                  if (busy) return;
                  setConfirming(false);
                  setAcknowledged(false);
                  setDeleteError(null);
                  setObligations(null);
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        )}
        <div className="mt-3">
          <Status error={deleteError} />
          {obligations && (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-900">
              {OBLIGATION_LINKS.filter(({ key }) => (obligations[key] ?? 0) > 0).map(
                ({ key, href }) => (
                  <li key={key}>
                    {t(`obligations.${key}`, { count: obligations[key] ?? 0 })}{" "}
                    <Link
                      href={href}
                      className={`font-semibold text-[#003580] underline ${focusRing}`}
                    >
                      {t(`obligations.${key}Link`)}
                    </Link>
                  </li>
                )
              )}
            </ul>
          )}
        </div>
      </Card>

      <p className="text-sm text-gray-800">
        {t.rich("noticeLink", {
          link: (c) => (
            <Link href="/privacy" className={`font-semibold text-[#003580] underline ${focusRing}`}>
              {c}
            </Link>
          ),
        })}
      </p>
      {reauth.dialog}
    </div>
  );
}

/**
 * F186: çerez tercihini geri çekmek onay vermek kadar kolay olsun — kayıtlı tercihi siler ve
 * sayfayı yeniler; çerez bandı yeniden açılır ve kullanıcı yeni seçimini yapar.
 */
export function CookiePreferencesButton() {
  const t = useTranslations("privacy.notice.cookies");
  return (
    <Button
      variant="secondary"
      className="mt-3 min-h-[44px] sm:min-h-0"
      onClick={() => {
        document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
        window.location.reload();
      }}
    >
      {t("change")}
    </Button>
  );
}
