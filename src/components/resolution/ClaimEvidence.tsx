"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Status, focusRing } from "@/components/ui/ui";
import { useClaimErrorText, type ClaimDetailResponse } from "./shared";

type Evidence = ClaimDetailResponse["evidence"][number];

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,application/pdf";

/** Kanıt galerisi + yükleme. Dosyalar çerezle yetkilendirilen API üzerinden sunulur. */
export default function ClaimEvidence({
  claimId,
  evidence,
  canUpload,
  onUploaded,
}: {
  claimId: string;
  evidence: Evidence[];
  canUpload: boolean;
  onUploaded: () => void;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const inputId = `claim-evidence-${claimId}`;
  const fileUrl = (e: Evidence) =>
    `/api/claims/${encodeURIComponent(claimId)}/evidence/${encodeURIComponent(e.id)}`;

  async function upload(file: File) {
    setBusy(true);
    setFeedback({});
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/evidence`, {
        method: "POST",
        body,
      });
      setFeedback({ message: t("evidence.uploaded") });
      onUploaded();
    } catch (err) {
      setFeedback({ error: claimError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900">{t("evidence.title")}</h3>
      {evidence.length === 0 ? (
        <p className="text-sm text-gray-700">{t("evidence.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {evidence.map((e) => {
            const by = t("evidence.by", {
              role: t(`role.${e.role}`),
              date: f.dateTime(e.createdAt),
            });
            return (
              <li key={e.id} className="rounded-md border border-gray-200 bg-white p-2 text-xs">
                {e.contentType === "application/pdf" ? (
                  <a
                    href={fileUrl(e)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block font-semibold text-[#003580] underline ${focusRing}`}
                  >
                    {t("evidence.pdf", {
                      size: f.number(e.byteSize / 1024, { maximumFractionDigits: 0 }),
                    })}
                  </a>
                ) : (
                  <a
                    href={fileUrl(e)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`block ${focusRing}`}
                  >
                    {/* Yetkili API akışı (çerez) — next/image optimizasyonu kullanılamaz */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={fileUrl(e)}
                      alt={t("evidence.imageAlt", {
                        role: t(`role.${e.role}`),
                        date: f.dateTime(e.createdAt),
                      })}
                      width={e.width ?? undefined}
                      height={e.height ?? undefined}
                      loading="lazy"
                      className="h-28 w-full rounded object-cover"
                    />
                  </a>
                )}
                <p className="mt-1 text-gray-600">{by}</p>
              </li>
            );
          })}
        </ul>
      )}
      {canUpload && (
        <div>
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-800">
            {t("evidence.upload")}
          </label>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            aria-describedby={`${inputId}-privacy`}
            className="mt-1 block text-sm text-gray-800"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <p id={`${inputId}-privacy`} className="mt-1 text-xs text-gray-600">
            {t("evidence.privacy")}
          </p>
        </div>
      )}
      <div aria-live="polite">
        {busy && <p className="text-sm text-gray-700">{t("evidence.uploading")}</p>}
      </div>
      <Status error={feedback.error} message={feedback.message} />
    </div>
  );
}
