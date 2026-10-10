"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, Status, focusRing } from "@/components/ui/ui";
import {
  EVIDENCE_IMAGE_MAX_MB,
  EVIDENCE_MAX_FILES,
  EVIDENCE_PDF_MAX_MB,
  useClaimErrorText,
  type ClaimDetailResponse,
} from "./shared";

type Evidence = ClaimDetailResponse["evidence"][number];

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "application/pdf",
];
const ACCEPT = ACCEPTED_TYPES.join(",");
const MB = 1024 * 1024;

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
  const [selected, setSelected] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const inputId = `claim-evidence-${claimId}`;
  const fileUrl = (e: Evidence) =>
    `/api/claims/${encodeURIComponent(claimId)}/evidence/${encodeURIComponent(e.id)}`;

  /** Seçim anında tür ve boyutu kontrol eder; uygunsa yüklemeden önce onaya bırakır. */
  function select(file: File) {
    setFeedback({});
    if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
      setSelected(null);
      setFeedback({ error: t("evidence.badType") });
      return;
    }
    const maxMb = file.type === "application/pdf" ? EVIDENCE_PDF_MAX_MB : EVIDENCE_IMAGE_MAX_MB;
    if (file.size > maxMb * MB) {
      setSelected(null);
      setFeedback({
        error: t("evidence.tooLarge", {
          size: f.number(file.size / MB, { maximumFractionDigits: 1 }),
          max: maxMb,
        }),
      });
      return;
    }
    setSelected(file);
  }

  async function upload(file: File) {
    if (busy) return;
    setBusy(true);
    setFeedback({});
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch(`/api/claims/${encodeURIComponent(claimId)}/evidence`, {
        method: "POST",
        body,
      });
      setSelected(null);
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
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-800">
            {t("evidence.upload")}
          </label>
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            disabled={busy}
            aria-describedby={`${inputId}-limits ${inputId}-visibility ${inputId}-privacy`}
            className="mt-1 block min-h-[44px] text-sm text-gray-800"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) select(file);
              e.target.value = "";
            }}
          />
          <p id={`${inputId}-limits`} className="text-xs text-gray-600">
            {t("evidence.limits", {
              imageMb: EVIDENCE_IMAGE_MAX_MB,
              pdfMb: EVIDENCE_PDF_MAX_MB,
              maxFiles: EVIDENCE_MAX_FILES,
              used: evidence.length,
            })}
          </p>
          <p id={`${inputId}-visibility`} className="text-xs text-gray-600">
            {t("evidence.visibility")}
          </p>
          <p id={`${inputId}-privacy`} className="text-xs text-gray-600">
            {t("evidence.privacy")}
          </p>
          {selected && (
            <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2 text-sm">
              <p className="break-all text-gray-800">
                {t("evidence.selected", {
                  name: selected.name,
                  size: f.number(selected.size / 1024, { maximumFractionDigits: 0 }),
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  aria-busy={busy || undefined}
                  onClick={() => void upload(selected)}
                >
                  {t("evidence.confirmUpload")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  {t("evidence.cancel")}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      <div aria-live="polite">
        {busy && <p className="text-sm text-gray-700">{t("evidence.uploading")}</p>}
      </div>
      <Status error={feedback.error} message={feedback.message} />
    </div>
  );
}
