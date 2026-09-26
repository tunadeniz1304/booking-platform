"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import type { AccessibilityCodeValue } from "@/lib/compliance/accessibility-codes";
import { Button, Card, Status, errorMessage, focusRing, useLoader } from "@/components/ui/ui";

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
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});

  const verify = (row: ReviewRow, verified: boolean) => {
    setStatus({});
    apiFetch(`/api/admin/accessibility/${row.id}`, {
      method: "POST",
      body: JSON.stringify({ verified }),
    })
      .then(() => {
        setStatus({ message: verified ? t("admin.verifiedOk") : t("admin.unverifiedOk") });
        rows.reload();
      })
      .catch((err: unknown) => setStatus({ error: errorMessage(err) }));
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
      <Status error={status.error ?? rows.error} message={status.message} />
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
              <p className="font-semibold text-gray-900">
                {t(`codes.${row.code}`)}
                {row.widthCm !== null && ` · ${t("width", { width: row.widthCm })}`}
              </p>
              <p className="text-gray-700">
                <a href={`/property/${row.propertyId}`} className={`underline ${focusRing}`}>
                  {row.propertyTitle}
                </a>{" "}
                ·{" "}
                {row.roomTypeName ? t("roomType", { name: row.roomTypeName }) : t("wholeProperty")}
              </p>
              {row.note && <p className="text-gray-700">{row.note}</p>}
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
                <Button variant="secondary" onClick={() => verify(row, false)}>
                  {t("admin.unverify")}
                </Button>
              ) : (
                <Button onClick={() => verify(row, true)}>{t("admin.verify")}</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
