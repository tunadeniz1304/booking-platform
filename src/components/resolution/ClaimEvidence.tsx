"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ApiError } from "@/lib/api-client";
import { apiUploadWithProgress } from "@/lib/api-upload-progress";
import { useFormat } from "@/i18n/use-format";
import { ResendVerificationButton } from "@/components/auth/AuthCard";
import { Button, Status, focusRing } from "@/components/ui/ui";
import {
  EVIDENCE_IMAGE_MAX_MB,
  EVIDENCE_MAX_FILES,
  EVIDENCE_PDF_MAX_MB,
  isEmailNotVerifiedError,
  useClaimErrorText,
  usePartyLabel,
  type ClaimDetailResponse,
  type ClaimType,
} from "./shared";

type Evidence = ClaimDetailResponse["evidence"][number];

interface QueuedFile {
  key: string;
  file: File;
  error?: string;
}

interface UploadProgress {
  index: number;
  total: number;
  name: string;
  fraction: number;
}

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

/**
 * HEIC/HEIF (HEVC) sunucudaki görsel işleyicide çözülemez; seçicide kabul edilmez (iOS bu
 * durumda fotoğrafı JPEG'e çevirir). Masaüstünde seçilirse yüklemeden önce açıkça söylenir.
 */
const isHeic = (file: File) =>
  /^image\/hei[cf](-sequence)?$/.test(file.type) || /\.hei[cf]$/i.test(file.name);
const isPdf = (file: File) =>
  file.type === "application/pdf" || (!file.type && /\.pdf$/i.test(file.name));
const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

/** Yalnız o dosyaya özgü hata mı (öyleyse sıradaki dosyalarla devam edilir)? */
function isPerFileError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 413 || err.code === "PAYLOAD_TOO_LARGE" || err.code === "VALIDATION_ERROR")
  );
}

/** Kanıt galerisi + yükleme. Dosyalar çerezle yetkilendirilen API üzerinden sunulur. */
export default function ClaimEvidence({
  claimId,
  evidence,
  canUpload,
  onUploaded,
  headingLevel = 2,
  claimType,
}: {
  claimId: string;
  evidence: Evidence[];
  canUpload: boolean;
  onUploaded: () => void;
  /** Başlıksız bir kartta bölüm başlığı h2; başka bir h2 bölümünün içindeyse 3 verin. */
  headingLevel?: 2 | 3;
  /** Verilirse yükleyen "Misafir" / "Ev sahibi" olarak adlandırılır (yoksa genel rol adı). */
  claimType?: ClaimType;
}) {
  const t = useTranslations("resolution");
  const f = useFormat();
  const claimError = useClaimErrorText();
  const partyLabel = usePartyLabel();
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [feedback, setFeedback] = useState<{
    error?: string;
    message?: string;
    needsVerify?: boolean;
  }>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const inputId = `claim-evidence-${claimId}`;
  const remaining = Math.max(0, EVIDENCE_MAX_FILES - evidence.length);
  const fileUrl = (e: Evidence) =>
    `/api/claims/${encodeURIComponent(claimId)}/evidence/${encodeURIComponent(e.id)}`;
  /** 1 KB altı bayt, 1 MB altı en az 1 kB, üstü MB olarak (yerel birim adıyla). */
  const fileSize = (bytes: number) =>
    bytes < 1024
      ? f.number(bytes, { style: "unit", unit: "byte", unitDisplay: "long" })
      : bytes < MB
        ? f.number(Math.max(1, Math.round(bytes / 1024)), { style: "unit", unit: "kilobyte" })
        : f.number(bytes / MB, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });

  // Odaktaki düğme (kaldırılan satır, boşalan liste) DOM'dan çıkınca odak dosya seçiciye,
  // sınıra ulaşıldıysa başlığa taşınır; render tamamlandıktan sonra çalışır.
  const [focusRequest, setFocusRequest] = useState({ title: false, seq: 0 });
  const restoreFocus = (title = false) => setFocusRequest((r) => ({ title, seq: r.seq + 1 }));
  useEffect(() => {
    if (focusRequest.seq === 0) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const target = focusRequest.title ? null : inputRef.current;
    (target ?? titleRef.current)?.focus();
  }, [focusRequest]);

  /** Seçim anında tür, boyut ve kalan hakkı kontrol eder; uygunları onaya bırakır. */
  function select(files: File[]) {
    const errors: string[] = [];
    const accepted: QueuedFile[] = [];
    const known = new Set(queue.map((q) => q.key));
    let overLimit = 0;
    for (const file of files) {
      const key = fileKey(file);
      if (known.has(key)) continue;
      if (isHeic(file)) {
        errors.push(t("evidence.heicUnsupported", { name: file.name }));
        continue;
      }
      if (file.type && !ACCEPTED_TYPES.includes(file.type)) {
        errors.push(t("evidence.badTypeFile", { name: file.name }));
        continue;
      }
      const maxMb = isPdf(file) ? EVIDENCE_PDF_MAX_MB : EVIDENCE_IMAGE_MAX_MB;
      if (file.size > maxMb * MB) {
        errors.push(
          t("evidence.tooLargeFile", { name: file.name, size: fileSize(file.size), max: maxMb })
        );
        continue;
      }
      if (queue.length + accepted.length >= remaining) {
        overLimit++;
        continue;
      }
      known.add(key);
      accepted.push({ key, file });
    }
    if (overLimit > 0) {
      errors.push(t("evidence.overLimit", { count: overLimit, maxFiles: EVIDENCE_MAX_FILES }));
    }
    if (accepted.length > 0) setQueue((q) => [...q, ...accepted]);
    setFeedback(errors.length > 0 ? { error: errors.join(" ") } : {});
  }

  function remove(key: string) {
    if (busy) return;
    setQueue((q) => q.filter((x) => x.key !== key));
    restoreFocus();
  }

  function clearQueue() {
    if (busy) return;
    setQueue([]);
    setFeedback({});
    restoreFocus();
  }

  /** Dosyalar sırayla yüklenir; dosyaya özgü hatada sıradakine geçilir, diğerlerinde durulur. */
  async function uploadAll() {
    if (busy || queue.length === 0) return;
    const items = queue;
    const total = items.length;
    setBusy(true);
    setFeedback({});
    setQueue((q) => q.map((x) => ({ key: x.key, file: x.file })));
    let uploaded = 0;
    let failed = 0;
    let stop: unknown = null;
    for (let i = 0; i < total; i++) {
      const item = items[i];
      setProgress({ index: i + 1, total, name: item.file.name, fraction: 0 });
      try {
        const body = new FormData();
        body.append("file", item.file);
        await apiUploadWithProgress(
          `/api/claims/${encodeURIComponent(claimId)}/evidence`,
          body,
          (fraction) => setProgress((p) => (p ? { ...p, fraction } : p))
        );
        uploaded++;
        setQueue((q) => q.filter((x) => x.key !== item.key));
      } catch (err) {
        if (!isPerFileError(err)) {
          stop = err;
          break;
        }
        failed++;
        const error = claimError(err);
        setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, error } : x)));
      }
    }
    setProgress(null);
    setBusy(false);
    if (stop) {
      const error = claimError(stop);
      setFeedback({
        error: uploaded > 0 ? t("evidence.stopped", { uploaded, total, error }) : error,
        needsVerify: isEmailNotVerifiedError(stop),
      });
    } else if (failed > 0) {
      setFeedback({ error: t("evidence.someFailed", { uploaded, total }) });
    } else {
      setFeedback({ message: t("evidence.uploadedCount", { count: uploaded }) });
      restoreFocus(evidence.length + uploaded >= EVIDENCE_MAX_FILES);
    }
    if (uploaded > 0) onUploaded();
  }

  return (
    <div className="space-y-3">
      <Heading
        ref={titleRef}
        tabIndex={-1}
        className="text-lg font-semibold text-gray-900 focus:outline-none"
      >
        {t("evidence.title")}
      </Heading>
      {evidence.length === 0 ? (
        <p className="text-sm text-gray-700">{t("evidence.empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {evidence.map((e, i) => {
            const role = partyLabel(claimType, e.role);
            const date = f.dateTime(e.createdAt);
            const position = { index: i + 1, total: evidence.length };
            const pdf = e.contentType === "application/pdf";
            return (
              <li key={e.id} className="rounded-md border border-gray-200 bg-white p-2 text-xs">
                {pdf ? (
                  // Sunucu PDF'i ek (attachment) olarak verir: boş sekme açmadan indirilir.
                  <a
                    href={fileUrl(e)}
                    download
                    className={`block font-semibold text-[#003580] underline ${focusRing}`}
                  >
                    {t("evidence.pdfDownload", { ...position, size: fileSize(e.byteSize) })}
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
                      alt={t("evidence.imageAltNumbered", { ...position, role, date })}
                      width={e.width ?? undefined}
                      height={e.height ?? undefined}
                      loading="lazy"
                      className="h-28 w-full rounded object-cover"
                    />
                    <span className="sr-only"> {t("evidence.newTab")}</span>
                  </a>
                )}
                {/* Görselde rol ve tarih alt metinde var; ekran okuyucu ikinci kez okumaz. */}
                <p className="mt-1 text-gray-600" aria-hidden={pdf ? undefined : true}>
                  {t("evidence.by", { role, date })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {canUpload &&
        (remaining === 0 && queue.length === 0 ? (
          <p className="text-sm text-gray-700">
            {t("evidence.limitReached", { maxFiles: EVIDENCE_MAX_FILES })}
          </p>
        ) : (
          <div className="space-y-2">
            <label htmlFor={inputId} className="block text-sm font-medium text-gray-800">
              {t("evidence.uploadMultiple")}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              multiple
              accept={ACCEPT}
              // Yüklemede odakta kalır; seçici açılmaz, seçim yok sayılır.
              aria-disabled={busy || undefined}
              aria-describedby={`${inputId}-limits ${inputId}-visibility ${inputId}-privacy`}
              className="mt-1 block min-h-[44px] text-sm text-gray-800 aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
              onClick={(e) => {
                if (busy) e.preventDefault();
              }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (!busy && files.length > 0) select(files);
                e.target.value = "";
              }}
            />
            <p id={`${inputId}-limits`} className="text-xs text-gray-600">
              {t("evidence.limitsLeft", {
                imageMb: EVIDENCE_IMAGE_MAX_MB,
                pdfMb: EVIDENCE_PDF_MAX_MB,
                maxFiles: EVIDENCE_MAX_FILES,
                remaining: Math.max(0, remaining - queue.length),
              })}
            </p>
            <p id={`${inputId}-visibility`} className="text-xs text-gray-600">
              {t("evidence.visibility")}
            </p>
            <p id={`${inputId}-privacy`} className="text-xs text-gray-600">
              {t("evidence.privacy")}
            </p>
            {queue.length > 0 && (
              <div className="space-y-2 rounded-md border border-gray-200 bg-white p-2 text-sm">
                <p id={`${inputId}-queue`} className="font-medium text-gray-800">
                  {t("evidence.queueTitle", { count: queue.length })}
                </p>
                <ul aria-labelledby={`${inputId}-queue`} className="space-y-2">
                  {queue.map((item) => (
                    <li
                      key={item.key}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1"
                    >
                      <span className="min-w-0 break-all text-gray-800">
                        {t("evidence.fileItem", {
                          name: item.file.name,
                          size: fileSize(item.file.size),
                        })}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-disabled={busy || undefined}
                        aria-label={t("evidence.removeFile", { name: item.file.name })}
                        onClick={() => remove(item.key)}
                      >
                        {t("evidence.remove")}
                      </Button>
                      {item.error && <p className="w-full text-red-700">{item.error}</p>}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" busy={busy} onClick={() => void uploadAll()}>
                    {busy
                      ? t("evidence.uploading")
                      : t("evidence.confirmUploadCount", { count: queue.length })}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    aria-disabled={busy || undefined}
                    onClick={clearQueue}
                  >
                    {t("evidence.cancel")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      <div aria-live="polite" className="space-y-1">
        {progress && (
          <>
            <p className="text-sm text-gray-700">
              {t("evidence.progress", {
                index: progress.index,
                total: progress.total,
                name: progress.name,
              })}
            </p>
            <div className="flex items-center gap-2">
              <progress
                max={100}
                value={Math.round(progress.fraction * 100)}
                aria-label={t("evidence.progressLabel", {
                  index: progress.index,
                  total: progress.total,
                })}
                className="h-2 w-full max-w-xs"
              />
              <span aria-hidden="true" className="text-sm tabular-nums text-gray-700">
                {f.number(progress.fraction, { style: "percent" })}
              </span>
            </div>
          </>
        )}
      </div>
      <Status error={feedback.error} message={feedback.message} />
      {feedback.needsVerify && <ResendVerificationButton />}
    </div>
  );
}
