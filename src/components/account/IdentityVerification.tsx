"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";

type KycStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REQUIRES_INPUT" | "FAILED";

interface IdentityStatus {
  status: KycStatus;
  provider: "mock" | "stripe";
  verifiedAt: string | null;
  lastError: string | null;
  required: { host: boolean; guest: boolean };
  testDocuments: string[];
}

const STATUS_STYLE: Record<KycStatus, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-800",
  PENDING: "bg-blue-50 text-blue-800",
  VERIFIED: "bg-green-50 text-green-800",
  REQUIRES_INPUT: "bg-amber-50 text-amber-900",
  FAILED: "bg-red-50 text-red-800",
};

const fetchStatus = () => apiFetch<IdentityStatus>("/api/account/identity");

/**
 * Hesap ▸ Kimlik doğrulama (P1-6): durum + başlat. Stripe Identity'de sağlayıcı sayfasına
 * yönlendirir; demo (mock) sağlayıcıda test belgesi seçilir ve sonuç hemen görünür.
 */
export default function IdentityVerification({ role }: { role?: string }) {
  const t = useTranslations("trust.kyc");
  const fmt = useFormat();
  const [data, setData] = useState<IdentityStatus | null>(null);
  const [doc, setDoc] = useState("valid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetchStatus()
        .then(setData)
        .catch(() => setError(t("loadFailed"))),
    [t]
  );

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(t("loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch<{ redirectUrl: string | null }>("/api/account/identity", {
        method: "POST",
        body: JSON.stringify(data.provider === "mock" ? { testDocument: doc } : {}),
      });
      if (res.redirectUrl) {
        setInfo(t("redirecting"));
        window.location.assign(res.redirectUrl);
        return;
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("startFailed"));
    } finally {
      setBusy(false);
    }
  }

  const canStart = data && data.status !== "VERIFIED" && data.status !== "PENDING";
  const showHost = data?.required.host && (role === "HOST" || role === "ADMIN");
  const showGuest = data?.required.guest;

  return (
    <section aria-labelledby="kyc-title" className="mt-8 rounded-xl bg-white p-6 shadow-sm">
      <h2 id="kyc-title" className="text-xl font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p className="mt-1 text-sm text-gray-600">{t("intro")}</p>
      {!data && !error && <p className="mt-3 text-sm text-gray-500">{t("loading")}</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="mt-3 text-sm text-gray-700">
          {info}
        </p>
      )}
      {data && (
        <div className="mt-3 space-y-2 text-sm">
          <p>
            {t("statusLabel")}{" "}
            <span
              data-testid="kyc-status"
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[data.status]}`}
            >
              {t(`status.${data.status}`)}
            </span>
          </p>
          {data.verifiedAt && (
            <p className="text-gray-700">{t("verifiedAt", { date: fmt.date(data.verifiedAt) })}</p>
          )}
          {data.lastError && (
            <p className="text-gray-700">{t("lastError", { code: data.lastError })}</p>
          )}
          {showHost && <p className="text-gray-700">{t("requiredHost")}</p>}
          {showGuest && <p className="text-gray-700">{t("requiredGuest")}</p>}
          {canStart && (
            <form onSubmit={start} className="mt-2 flex flex-wrap items-end gap-3">
              {data.provider === "mock" && (
                <div>
                  <p className="mb-1 text-xs text-gray-600">{t("mockNotice")}</p>
                  <label htmlFor="kyc-doc" className="block text-xs font-medium text-gray-700">
                    {t("testDocumentLabel")}
                  </label>
                  <select
                    id="kyc-doc"
                    value={doc}
                    onChange={(e) => setDoc(e.target.value)}
                    className="mt-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  >
                    {data.testDocuments.map((d) => (
                      <option key={d} value={d}>
                        {t(`testDocuments.${d}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-[#003580] px-4 py-2 text-sm font-medium text-white hover:bg-[#00224f] disabled:opacity-60"
              >
                {busy ? t("starting") : data.status === "NOT_STARTED" ? t("start") : t("retry")}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
