"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import { Button, Card, Status, errorMessage, focusRing } from "@/components/ui/ui";
import { useReauth } from "@/components/account/ReauthDialog";

/** KVKK self-servis (P2-5): veri dışa aktarımı ve hesap silme. */
export default function PrivacyCenter() {
  const t = useTranslations("privacy.center");
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
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
      setFeedback({ error: errorMessage(err) });
    }
  }

  async function remove() {
    setBusy(true);
    setFeedback({});
    try {
      await reauth.run(() => apiFetch("/api/account", { method: "DELETE" }));
      setFeedback({ message: t("deleted") });
      router.push("/");
      router.refresh();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
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
        <p className="mb-3 text-sm text-gray-800">{t("deleteBody")}</p>
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
            <div className="flex items-center gap-2">
              <input
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
            <div className="flex gap-2">
              <Button variant="danger" disabled={!acknowledged || busy} onClick={remove}>
                {busy ? t("deleting") : t("confirmDelete")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(false);
                  setAcknowledged(false);
                }}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        )}
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
