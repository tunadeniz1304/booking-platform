"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { Button, ButtonLink, Card, Status, focusRing } from "@/components/ui/ui";
import {
  ReauthCancelledError,
  useAccountErrorText,
  useReauth,
} from "@/components/account/ReauthDialog";
import { setSessionUserCache } from "@/components/layout/useSessionUserCache";
import { openCookiePreferences } from "@/components/privacy/CookieConsent";

/** `ACCOUNT_HAS_OBLIGATIONS` ayrıntısı (sunucu: privacy-service accountObligations). */
type Obligations = { hostedBookings?: number; pendingPayouts?: number; openClaims?: number };

/** `DELETE /api/account` yanıtı (sunucu: privacy-service DeleteAccountResult). */
type DeleteResult = { cancelledBookings?: string[]; cancelledTransfers?: string[] };

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
  const [exporting, setExporting] = useState(false);
  const [exportFile, setExportFile] = useState<{ url: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [obligations, setObligations] = useState<Obligations | null>(null);
  const [deleted, setDeleted] = useState<{ bookings: number; transfers: number } | null>(null);
  const ackRef = useRef<HTMLInputElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const deletedHeadingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef(false);
  const errorText = useAccountErrorText();
  // v4#2: hesap silme yakın zamanda yeniden doğrulama ister.
  const reauth = useReauth();

  // F1190: nesne URL'si hemen iptal edilmez (bazı mobil tarayıcılarda indirme başlamaz); yedek
  // bağlantı için yeni dışa aktarımda ya da sayfadan çıkınca iptal edilir.
  useEffect(() => {
    if (!exportFile) return;
    return () => URL.revokeObjectURL(exportFile.url);
  }, [exportFile]);

  async function download() {
    if (exporting) return;
    setExporting(true);
    setFeedback({});
    setExportFile(null);
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
      setExportFile({ url, name: fileName });
      setFeedback({ message: t("exported", { file: fileName }) });
    } catch (err) {
      setFeedback({ error: errorText(err, t("exportFailed")) });
    } finally {
      setExporting(false);
    }
  }

  // F439: onay adımı açılınca odak onay kutusuna (grup adı duyurulur); "Vazgeç"te yeniden
  // görünen "Hesabımı sil" düğmesine döner.
  useEffect(() => {
    if (confirming) {
      ackRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      deleteButtonRef.current?.focus();
    }
  }, [confirming]);

  // F585: silme sonucu yönlendirmeyle kaybolmaz; odak sonuç başlığına taşınır.
  useEffect(() => {
    if (deleted) deletedHeadingRef.current?.focus();
  }, [deleted]);

  async function remove() {
    if (busy) return;
    // F1191: düğme odaklanabilir kalır; onay yoksa kullanıcı onay kutusuna yönlendirilir.
    if (!acknowledged) {
      ackRef.current?.focus();
      return;
    }
    setBusy(true);
    setDeleteError(null);
    setObligations(null);
    try {
      const result = await reauth.run(() =>
        apiFetch<DeleteResult>("/api/account", { method: "DELETE" })
      );
      // Başlık oturumu kapalı gösterir; sonuç bu sayfada kalır, gezinme kullanıcıdadır.
      setSessionUserCache(null);
      setDeleted({
        bookings: result.cancelledBookings?.length ?? 0,
        transfers: result.cancelledTransfers?.length ?? 0,
      });
      router.refresh();
    } catch (err) {
      // F640: kullanıcı yeniden doğrulamadan kendisi vazgeçtiyse hata gösterilmez.
      if (err instanceof ReauthCancelledError) {
        setBusy(false);
        return;
      }
      // F193: hata silme kartının içinde; yükümlülük varsa nedenleri ve çözüm bağlantıları.
      const found = obligationsOf(err);
      setObligations(found);
      setDeleteError(found ? t("obligations.title") : errorText(err, t("deleteFailed")));
      setBusy(false);
    }
  }

  if (deleted) {
    return (
      <section
        aria-labelledby="account-deleted-title"
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <h2
          id="account-deleted-title"
          ref={deletedHeadingRef}
          tabIndex={-1}
          className="mb-3 text-lg font-semibold text-gray-900 focus:outline-none"
        >
          {t("deleted")}
        </h2>
        <div className="space-y-2 text-sm text-gray-800">
          <p>{t("deletedBody")}</p>
          {deleted.bookings > 0 && <p>{t("deletedBookings", { count: deleted.bookings })}</p>}
          {deleted.transfers > 0 && <p>{t("deletedTransfers", { count: deleted.transfers })}</p>}
        </div>
        <ButtonLink href="/" className="mt-4 min-h-[44px] sm:min-h-0">
          {t("deletedHome")}
        </ButtonLink>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <Card title={t("exportTitle")} id="export">
        <p className="mb-3 text-sm text-gray-800">{t("exportBody")}</p>
        <Button busy={exporting} onClick={download}>
          {exporting ? t("exporting") : t("exportButton")}
        </Button>
        {/* F1088: canlı bölge başlığın altında boşluk bırakmasın diye ilgili kartın içinde. */}
        <div className="mt-3">
          <Status error={feedback.error} message={feedback.message} />
          {exportFile && !feedback.error && (
            <p className="mt-1 text-sm">
              <a
                href={exportFile.url}
                download={exportFile.name}
                className={`font-semibold text-[#003580] underline ${focusRing}`}
              >
                {t("exportFallback")}
              </a>
            </p>
          )}
        </div>
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
          <Button ref={deleteButtonRef} variant="danger" onClick={() => setConfirming(true)}>
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
              <label id="delete-ack-label" htmlFor="delete-ack" className="text-sm text-gray-900">
                {t("acknowledge")}
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="danger"
                aria-disabled={!acknowledged || undefined}
                aria-describedby={acknowledged ? undefined : "delete-ack-label"}
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
                  returnFocus.current = true;
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
 * F186: çerez tercihini geri çekmek onay vermek kadar kolay olsun — çerez bandı sayfa
 * yenilenmeden, mevcut seçim işaretli olarak yeniden açılır.
 */
export function CookiePreferencesButton() {
  const t = useTranslations("privacy.notice.cookies");
  return (
    <Button
      variant="secondary"
      className="mt-3 min-h-[44px] sm:min-h-0"
      onClick={openCookiePreferences}
    >
      {t("change")}
    </Button>
  );
}
