"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import { Button, Card, Status, errorMessage, focusRing } from "@/components/ui/ui";

/** KVKK self-servis (P2-5): veri dışa aktarımı ve hesap silme. */
export default function PrivacyCenter() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{ error?: string; message?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);

  async function download() {
    setFeedback({});
    try {
      const data = await apiFetch<unknown>("/api/account");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "verilerim.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setFeedback({ message: "Verileriniz indirildi (verilerim.json)." });
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    }
  }

  async function remove() {
    setBusy(true);
    setFeedback({});
    try {
      await apiFetch("/api/account", { method: "DELETE" });
      setFeedback({ message: "Hesabınız silindi. Ana sayfaya yönlendiriliyorsunuz…" });
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
      <Card title="Verilerimi indir" id="export">
        <p className="mb-3 text-sm text-gray-800">
          Hesabınıza ait kişisel verilerin (profil, rezervasyonlar, yorumlar, favoriler) bir
          kopyasını JSON olarak indirin. Parola özeti dışa aktarılmaz.
        </p>
        <Button onClick={download}>Verilerimi indir</Button>
      </Card>

      <Card title="Hesabımı sil" id="delete">
        <p className="mb-3 text-sm text-gray-800">
          Kişisel alanlarınız silinir veya takma adla değiştirilir. Rezervasyon ve ödeme kayıtları
          yasal saklama yükümlülüğü nedeniyle anonimleştirilerek tutulur. Bu işlem geri alınamaz.
        </p>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Hesabımı sil
          </Button>
        ) : (
          <div
            role="group"
            aria-labelledby="delete-confirm-title"
            className="space-y-3 rounded-md border border-red-300 bg-red-50 p-3"
          >
            <p id="delete-confirm-title" className="text-sm font-semibold text-red-900">
              Hesabınızı kalıcı olarak silmek istediğinize emin misiniz?
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
                İşlemin geri alınamayacağını anladım.
              </label>
            </div>
            <div className="flex gap-2">
              <Button variant="danger" disabled={!acknowledged || busy} onClick={remove}>
                {busy ? "Siliniyor…" : "Evet, hesabımı sil"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirming(false);
                  setAcknowledged(false);
                }}
              >
                Vazgeç
              </Button>
            </div>
          </div>
        )}
      </Card>

      <p className="text-sm text-gray-800">
        Verilerinizin nasıl işlendiğini{" "}
        <Link href="/privacy" className={`font-semibold text-[#003580] underline ${focusRing}`}>
          aydınlatma metninde
        </Link>{" "}
        okuyabilirsiniz.
      </p>
    </div>
  );
}
