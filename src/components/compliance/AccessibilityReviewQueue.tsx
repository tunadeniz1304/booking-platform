"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import type { AccessibilityCodeValue } from "@/lib/compliance/accessibility-codes";
import { Button, Card, Status, focusRing, useErrorText, useLoader } from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface ReviewRow {
  id: string;
  propertyId: string;
  propertyTitle: string;
  code: AccessibilityCodeValue;
  roomTypeName: string | null;
  widthCm: number | null;
  note: string | null;
  evidencePhotoUrl: string | null;
  verified: boolean;
  createdAt: string;
  verifiedAt: string | null;
}

type QueueTab = "pending" | "verified";

/**
 * Erişilebilirlik doğrulama kuyruğu (ADMIN, P2-1a / P1-13(e)): kanıtlı ama doğrulanmamış
 * beyanlar; kanıt fotoğrafına bakılarak doğrulanır ya da doğrulama kaldırılır.
 */
export default function AccessibilityReviewQueue() {
  const t = useTranslations("compliance.accessibility");
  const f = useFormat();
  const [tab, setTab] = useState<QueueTab>("pending");
  // Yanıt hangi filtreye aitse onunla saklanır: filtre değişince eski liste gösterilmez.
  const rows = useLoader(
    () =>
      apiFetch<{ features: ReviewRow[] }>(`/api/admin/accessibility?status=${tab}`).then((r) => ({
        tab,
        features: r.features,
      })),
    [tab]
  );
  const list = rows.data?.tab === tab ? rows.data.features : null;
  const loading = !list && !rows.error;
  const errorText = useErrorText();
  const tc = useTranslations("common");
  const { confirm, confirmDialog } = useConfirm();
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<{ row: ReviewRow; verified: boolean } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const focusAfterReload = useRef<string | null>(null);
  const [preview, setPreview] = useState<ReviewRow | null>(null);
  const previewRef = useRef<HTMLDialogElement>(null);
  const previewReturn = useRef<HTMLElement | null>(null);

  // İşlenen satır listeden kalkınca odak sonraki satıra (yoksa kart başlığına) taşınır.
  useEffect(() => {
    const target = focusAfterReload.current;
    if (!target) return;
    focusAfterReload.current = null;
    const el =
      document.getElementById(target) ?? document.getElementById("accessibility-review-title");
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus();
  }, [rows.data]);

  useEffect(() => {
    const dialog = previewRef.current;
    if (preview && dialog && !dialog.open) dialog.showModal();
  }, [preview]);

  const openPreview = (row: ReviewRow, trigger: HTMLElement) => {
    previewReturn.current = trigger;
    setPreview(row);
  };

  const onPreviewClose = () => {
    setPreview(null);
    const target = previewReturn.current;
    previewReturn.current = null;
    if (target && target.isConnected) target.focus();
  };

  const names = (row: ReviewRow) => ({
    name: t(`codes.${row.code}`),
    property: row.propertyTitle,
  });

  // F776: bilinen hata kodları arayüz dilinde ve ne yapılacağını söyleyen metinle gösterilir.
  const actionErrorText = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === "ACCESSIBILITY_EVIDENCE_REQUIRED") return t("admin.errors.evidenceRequired");
      if (err.code === "NOT_FOUND") return t("admin.errors.notFound");
    }
    return errorText(err);
  };

  const verify = async (row: ReviewRow, verified: boolean, undo = false) => {
    if (pendingRef.current) return;
    if (!undo) {
      const ok = await confirm({
        title: verified ? t("admin.confirm.verifyTitle") : t("admin.confirm.unverifyTitle"),
        body: (
          <>
            <span className="block">
              {t("admin.confirm.body", {
                ...names(row),
                scope: row.roomTypeName
                  ? t("roomType", { name: row.roomTypeName })
                  : t("wholeProperty"),
              })}
            </span>
            <span className="mt-1 block">
              {verified ? t("admin.confirm.verifyEffect") : t("admin.confirm.unverifyEffect")}
            </span>
          </>
        ),
        confirmLabel: verified ? t("admin.confirm.verify") : t("admin.confirm.unverify"),
        tone: verified ? "primary" : "danger",
      });
      if (!ok || pendingRef.current) return;
    }
    const current = list ?? [];
    const index = current.findIndex((x) => x.id === row.id);
    const next = current[index + 1] ?? current[index - 1];
    pendingRef.current = row.id;
    setPending(row.id);
    setMessage(null);
    setActionError(null);
    if (!undo) setLastAction(null);
    setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
    try {
      await apiFetch(`/api/admin/accessibility/${row.id}`, {
        method: "POST",
        body: JSON.stringify({ verified }),
      });
      setMessage(
        verified ? t("admin.verifiedDone", names(row)) : t("admin.unverifiedDone", names(row))
      );
      // Geri alınan satır listeye döner; odak onun başlığına gider.
      if (undo) {
        setLastAction(null);
        focusAfterReload.current = `a11y-${row.id}-title`;
      } else {
        setLastAction({ row, verified });
        focusAfterReload.current = next ? `a11y-${next.id}-title` : "accessibility-review-title";
      }
      rows.reload();
    } catch (err: unknown) {
      const text = actionErrorText(err);
      // Geri alınan satır bu listede olmayabilir: hata üstte gösterilir, yeniden denenebilir.
      if (undo) {
        setActionError(text);
      } else {
        setRowErrors((prev) => ({ ...prev, [row.id]: text }));
      }
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  return (
    <Card title={t("admin.title")} id="accessibility-review">
      <p className="mb-3 text-sm text-gray-700">{t("admin.intro")}</p>
      {confirmDialog}
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-gray-800">{t("admin.filter")}</legend>
        <div className="inline-flex flex-wrap rounded-md border border-gray-500 p-0.5">
          {(["pending", "verified"] as const).map((key) => (
            <label
              key={key}
              className="relative inline-flex min-h-[2.5rem] cursor-pointer items-center rounded px-3 text-sm text-gray-800 has-[:checked]:bg-blue-50 has-[:checked]:font-semibold has-[:checked]:text-[#003580] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[#003580]"
            >
              <input
                type="radio"
                name="accessibility-review-filter"
                value={key}
                checked={tab === key}
                onChange={() => setTab(key)}
                className="sr-only"
              />
              {tab === key && <span aria-hidden="true">{"✓ "}</span>}
              {t(`admin.tabs.${key}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <Status error={actionError ?? rows.error} message={message} />
      {lastAction && (
        <Button
          variant="secondary"
          className="mt-1"
          busy={pending === lastAction.row.id}
          aria-label={t("admin.undoLabel", names(lastAction.row))}
          onClick={() => void verify(lastAction.row, !lastAction.verified, true)}
        >
          {t("admin.undo")}
        </Button>
      )}
      {loading && (
        <p role="status" className="text-sm text-gray-600">
          {tc("loading")}
        </p>
      )}
      {list?.length === 0 && <p className="text-sm text-gray-600">{t("admin.empty")}</p>}
      <ul className="divide-y divide-gray-200" aria-busy={loading || undefined}>
        {list?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            {row.evidencePhotoUrl && (
              <button
                type="button"
                aria-label={t("admin.enlargeEvidence", { name: t(`codes.${row.code}`) })}
                onClick={(e) => openPreview(row, e.currentTarget)}
                className={`shrink-0 cursor-zoom-in rounded ${focusRing}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- kanıt önizlemesi, optimize edilmez */}
                <img src={row.evidencePhotoUrl} alt="" className="h-16 w-24 rounded object-cover" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <h3 id={`a11y-${row.id}-title`} tabIndex={-1} className="font-semibold text-gray-900">
                {t(`codes.${row.code}`)}
                {row.widthCm !== null && ` · ${t("width", { width: row.widthCm })}`}
              </h3>
              <p className="text-gray-700">
                {/* F786: ilan yeni sekmede açılır; kuyruk, filtre ve geri alma durumu korunur. */}
                <a
                  href={`/property/${row.propertyId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`underline ${focusRing}`}
                >
                  {row.propertyTitle}
                  <span className="sr-only"> {t("host.newTab")}</span>
                  <span aria-hidden="true" className="ml-1">
                    {"↗"}
                  </span>
                </a>{" "}
                ·{" "}
                {row.roomTypeName ? t("roomType", { name: row.roomTypeName }) : t("wholeProperty")}
              </p>
              <p className="text-gray-700">
                {t("admin.submittedAt", { date: f.date(row.createdAt, "medium") })}
                {row.verifiedAt &&
                  ` · ${t("admin.verifiedAt", { date: f.date(row.verifiedAt, "medium") })}`}
              </p>
              {row.note && <p className="break-words text-gray-700">{row.note}</p>}
              <Status error={rowErrors[row.id] || null} />
            </div>
            <div className="flex gap-2">
              {row.evidencePhotoUrl && (
                <a
                  href={row.evidencePhotoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex min-h-[2.5rem] items-center font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {t("evidence")}
                  <span className="sr-only">
                    : {t(`codes.${row.code}`)} – {row.propertyTitle} {t("host.newTab")}
                  </span>
                  <span aria-hidden="true" className="ml-1">
                    {"↗"}
                  </span>
                </a>
              )}
              {row.verified ? (
                <Button
                  variant="secondary"
                  busy={pending === row.id}
                  aria-label={t("admin.unverifyLabel", names(row))}
                  onClick={() => void verify(row, false)}
                >
                  {t("admin.unverify")}
                </Button>
              ) : (
                <Button
                  busy={pending === row.id}
                  aria-label={t("admin.verifyLabel", names(row))}
                  onClick={() => void verify(row, true)}
                >
                  {t("admin.verify")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {preview?.evidencePhotoUrl && (
        <dialog
          ref={previewRef}
          aria-labelledby="accessibility-preview-title"
          onClose={onPreviewClose}
          className="w-[48rem] max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-5 shadow-sm backdrop:bg-black/40"
        >
          <h2 id="accessibility-preview-title" className="text-lg font-semibold text-gray-900">
            {t(`codes.${preview.code}`)} · {preview.propertyTitle}
          </h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- kanıt görüntüsü, optimize edilmez */}
          <img
            src={preview.evidencePhotoUrl}
            alt={t("admin.evidenceAlt", { name: t(`codes.${preview.code}`) })}
            className="mt-3 max-h-[70vh] w-full rounded object-contain"
          />
          <div className="mt-4 flex justify-end">
            <Button
              variant="secondary"
              className="min-h-[44px] sm:min-h-0"
              onClick={() => previewRef.current?.close()}
            >
              {t("admin.closePreview")}
            </Button>
          </div>
        </dialog>
      )}
    </Card>
  );
}
