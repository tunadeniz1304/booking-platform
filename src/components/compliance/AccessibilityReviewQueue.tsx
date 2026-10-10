"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import type { AccessibilityCodeValue } from "@/lib/compliance/accessibility-codes";
import { Button, Card, Status, focusRing, useErrorText, useLoader } from "@/components/ui/ui";

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
}

/**
 * Erişilebilirlik doğrulama kuyruğu (ADMIN, P2-1a / P1-13(e)): kanıtlı ama doğrulanmamış
 * beyanlar; kanıt fotoğrafına bakılarak doğrulanır ya da doğrulama kaldırılır.
 */
export default function AccessibilityReviewQueue() {
  const t = useTranslations("compliance.accessibility");
  const [tab, setTab] = useState<"pending" | "verified">("pending");
  const rows = useLoader(
    () =>
      apiFetch<{ features: ReviewRow[] }>(`/api/admin/accessibility?status=${tab}`).then(
        (r) => r.features
      ),
    [tab]
  );
  const errorText = useErrorText();
  const tc = useTranslations("common");
  const [message, setMessage] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const focusAfterReload = useRef<string | null>(null);

  // İşlenen satır listeden kalkınca odak sonraki satıra (yoksa kart başlığına) taşınır.
  useEffect(() => {
    const target = focusAfterReload.current;
    if (!target) return;
    focusAfterReload.current = null;
    const el = document.getElementById(target);
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus();
  }, [rows.data]);

  const verify = async (row: ReviewRow, verified: boolean) => {
    if (pendingRef.current) return;
    const list = rows.data ?? [];
    const index = list.findIndex((x) => x.id === row.id);
    const next = list[index + 1] ?? list[index - 1];
    pendingRef.current = row.id;
    setPending(row.id);
    setMessage(null);
    setRowErrors((prev) => ({ ...prev, [row.id]: "" }));
    try {
      await apiFetch(`/api/admin/accessibility/${row.id}`, {
        method: "POST",
        body: JSON.stringify({ verified }),
      });
      setMessage(verified ? t("admin.verifiedOk") : t("admin.unverifiedOk"));
      focusAfterReload.current = next ? `a11y-${next.id}-title` : "accessibility-review-title";
      rows.reload();
    } catch (err: unknown) {
      setRowErrors((prev) => ({ ...prev, [row.id]: errorText(err) }));
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  };

  return (
    <Card title={t("admin.title")} id="accessibility-review">
      <p className="mb-3 text-sm text-gray-700">{t("admin.intro")}</p>
      <div role="group" aria-label={t("admin.filter")} className="mb-3 flex gap-2">
        {(["pending", "verified"] as const).map((key) => (
          <Button
            key={key}
            variant={tab === key ? "primary" : "secondary"}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {t(`admin.tabs.${key}`)}
          </Button>
        ))}
      </div>
      <Status error={rows.error} message={message} />
      {!rows.data && !rows.error && (
        <p role="status" className="text-sm text-gray-600">
          {tc("loading")}
        </p>
      )}
      {rows.data?.length === 0 && <p className="text-sm text-gray-600">{t("admin.empty")}</p>}
      <ul className="divide-y divide-gray-200">
        {rows.data?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            {row.evidencePhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- kanıt önizlemesi, optimize edilmez
              <img
                src={row.evidencePhotoUrl}
                alt={t("admin.evidenceAlt", { name: t(`codes.${row.code}`) })}
                className="h-16 w-24 rounded object-cover"
              />
            )}
            <div className="min-w-0 flex-1">
              <h3 id={`a11y-${row.id}-title`} tabIndex={-1} className="font-semibold text-gray-900">
                {t(`codes.${row.code}`)}
                {row.widthCm !== null && ` · ${t("width", { width: row.widthCm })}`}
              </h3>
              <p className="text-gray-700">
                <a href={`/property/${row.propertyId}`} className={`underline ${focusRing}`}>
                  {row.propertyTitle}
                </a>{" "}
                ·{" "}
                {row.roomTypeName ? t("roomType", { name: row.roomTypeName }) : t("wholeProperty")}
              </p>
              {row.note && <p className="break-words text-gray-700">{row.note}</p>}
              <Status error={rowErrors[row.id] || null} />
            </div>
            <div className="flex gap-2">
              {row.evidencePhotoUrl && (
                <a
                  href={row.evidencePhotoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex min-h-[2.5rem] items-center font-semibold text-[#003580] underline ${focusRing}`}
                >
                  {t("evidence")}
                </a>
              )}
              {row.verified ? (
                <Button
                  variant="secondary"
                  busy={pending === row.id}
                  onClick={() => void verify(row, false)}
                >
                  {t("admin.unverify")}
                </Button>
              ) : (
                <Button busy={pending === row.id} onClick={() => void verify(row, true)}>
                  {t("admin.verify")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
