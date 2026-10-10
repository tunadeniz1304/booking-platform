"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/lib/api-client";
import {
  ACCESSIBILITY_CODES,
  MAX_WIDTH_CM,
  MIN_WIDTH_CM,
  WIDTH_CODE,
  type AccessibilityCodeValue,
} from "@/lib/compliance/accessibility-codes";
import {
  Button,
  Card,
  Field,
  Status,
  errorMessage,
  focusRing,
  inputClass,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/**
 * P2-1a / P1-13(e): ev sahibi erişilebilirlik beyanları — özellik ekle, kanıt fotoğrafı bağla,
 * sil. Kanıt ya da kod değişince doğrulama DB tetiğiyle düşer; yayında yalnız doğrulanmışlar.
 */

interface Feature {
  id: string;
  code: AccessibilityCodeValue;
  roomTypeId: string | null;
  roomTypeName: string | null;
  widthCm: number | null;
  note: string | null;
  evidencePhotoId: string | null;
  evidencePhotoUrl: string | null;
  verified: boolean;
}

interface Photo {
  id: string;
  url: string;
}

interface PropertyRef {
  id: string;
  title: string;
  rooms: ReadonlyArray<{ id: string; name: string }>;
}

export default function AccessibilityPanel({
  properties,
}: {
  properties: ReadonlyArray<PropertyRef>;
}) {
  const t = useTranslations("compliance.accessibility");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const property = properties.find((p) => p.id === propertyId);
  const features = useLoader(
    () =>
      propertyId
        ? apiFetch<{ features: Feature[] }>(
            `/api/host/properties/${propertyId}/accessibility`
          ).then((r) => r.features)
        : Promise.resolve([] as Feature[]),
    [propertyId]
  );
  const photos = useLoader(
    () =>
      propertyId
        ? apiFetch<{ photos: Photo[] }>(`/api/host/properties/${propertyId}/photos`).then(
            (r) => r.photos
          )
        : Promise.resolve([] as Photo[]),
    [propertyId]
  );
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [code, setCode] = useState<AccessibilityCodeValue>("STEP_FREE_ENTRANCE");
  const [widthError, setWidthError] = useState<string | null>(null);
  // Satır içi kanıt seçimi yalnız yerel taslaktır; "Kanıtı kaydet" ile gönderilir (WCAG 3.2.2).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addEvidence, setAddEvidence] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const photoOptions = photos.data ?? [];
  const photoLabel = (id: string) =>
    t("host.photoOption", { index: String(photoOptions.findIndex((p) => p.id === id) + 1) });

  const photoUrl = (id: string) => photoOptions.find((p) => p.id === id)?.url ?? null;

  async function run(key: string, fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setStatus({});
    try {
      await fn();
      setStatus({ message: ok });
      features.reload();
      return true;
    } catch (err) {
      setStatus({ error: errorMessage(err) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const width = String(f.get("widthCm") ?? "");
    if (code === WIDTH_CODE && width) {
      const n = Number(width);
      if (!Number.isInteger(n) || n < MIN_WIDTH_CM || n > MAX_WIDTH_CM) {
        setWidthError(t("host.widthRange", { min: MIN_WIDTH_CM, max: MAX_WIDTH_CM }));
        return;
      }
    }
    setWidthError(null);
    const form = e.currentTarget;
    void run(
      "add",
      async () => {
        await apiFetch(`/api/host/properties/${propertyId}/accessibility`, {
          method: "POST",
          body: JSON.stringify({
            code,
            roomTypeId: String(f.get("roomTypeId") ?? "") || null,
            widthCm: code === WIDTH_CODE && width ? Number(width) : null,
            note: String(f.get("note") ?? "").trim() || null,
            evidencePhotoId: String(f.get("evidencePhotoId") ?? "") || null,
          }),
        });
        form.reset();
        setAddEvidence("");
      },
      t("host.added")
    );
  }

  async function saveEvidence(feature: Feature, photoId: string) {
    const name = t(`codes.${feature.code}`);
    if (
      feature.verified &&
      !(await confirm({
        title: t("host.evidenceConfirmTitle", { name }),
        body: t("host.evidenceVerifiedWarning"),
        confirmLabel: t("host.saveEvidence"),
        tone: "danger",
      }))
    )
      return;
    const ok = await run(
      `evidence-${feature.id}`,
      () =>
        apiFetch(`/api/host/properties/${propertyId}/accessibility/${feature.id}`, {
          method: "PATCH",
          body: JSON.stringify({ evidencePhotoId: photoId || null }),
        }),
      t("host.evidenceSaved")
    );
    if (ok)
      setDrafts((d) => {
        const next = { ...d };
        delete next[feature.id];
        return next;
      });
  }

  async function remove(feature: Feature) {
    const name = t(`codes.${feature.code}`);
    const scope = feature.roomTypeName
      ? t("roomType", { name: feature.roomTypeName })
      : t("wholeProperty");
    if (
      !(await confirm({
        title: t("host.deleteConfirmTitle", { name, scope }),
        body: feature.verified ? t("host.deleteConfirmVerified") : t("host.deleteConfirmBody"),
        confirmLabel: t("host.deleteConfirm"),
        tone: "danger",
      }))
    )
      return;
    await run(
      `delete-${feature.id}`,
      () =>
        apiFetch(`/api/host/properties/${propertyId}/accessibility/${feature.id}`, {
          method: "DELETE",
        }),
      t("host.deleted")
    );
  }

  const evidencePreview = (id: string) => {
    const url = id ? photoUrl(id) : null;
    if (!url) return null;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- kanıt önizlemesi, optimize edilmez
      <img
        src={url}
        alt={t("host.evidencePreviewAlt", { photo: photoLabel(id) })}
        className="h-16 w-24 rounded object-cover"
      />
    );
  };

  if (properties.length === 0) return null;

  return (
    <Card title={t("host.title")} id="host-accessibility">
      <p className="mb-3 text-sm text-gray-700">{t("host.intro")}</p>
      {properties.length > 1 && (
        <Field id="a11y-property" label={t("host.property")}>
          <select
            id="a11y-property"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className={inputClass}
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Status error={features.error ?? photos.error} />
      <div role="status" aria-live="polite">
        {features.data === null && !features.error && (
          <p className="text-sm text-gray-600">{t("host.loading")}</p>
        )}
      </div>
      {features.data?.length === 0 && (
        <p className="mt-2 text-sm text-gray-700">{t("host.empty")}</p>
      )}
      {features.data && features.data.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-200" aria-label={t("host.listLabel")}>
          {features.data.map((feature) => {
            const saved = feature.evidencePhotoId ?? "";
            const draft = drafts[feature.id] ?? saved;
            const dirty = draft !== saved;
            const hintId = `a11y-evidence-${feature.id}-hint`;
            return (
              <li key={feature.id} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900">
                    {t(`codes.${feature.code}`)}
                    {feature.widthCm !== null && (
                      <span className="font-normal text-gray-700">
                        {" "}
                        · {t("width", { width: feature.widthCm })}
                      </span>
                    )}
                  </p>
                  <p className="text-gray-700">
                    {feature.roomTypeName
                      ? t("roomType", { name: feature.roomTypeName })
                      : t("wholeProperty")}
                  </p>
                  <p
                    className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                      feature.verified
                        ? "bg-green-100 text-green-900"
                        : feature.evidencePhotoId
                          ? "bg-amber-100 text-amber-900"
                          : "bg-gray-200 text-gray-900"
                    }`}
                  >
                    {feature.verified
                      ? t("verified")
                      : feature.evidencePhotoId
                        ? t("host.pendingReview")
                        : t("host.needsEvidence")}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label
                      htmlFor={`a11y-evidence-${feature.id}`}
                      className="block text-xs font-medium text-gray-800"
                    >
                      {t("evidence")}
                    </label>
                    <select
                      id={`a11y-evidence-${feature.id}`}
                      value={draft}
                      aria-describedby={hintId}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDrafts((d) => ({ ...d, [feature.id]: value }));
                      }}
                      className={`${inputClass} min-h-[44px]`}
                    >
                      <option value="">{t("host.noEvidence")}</option>
                      {photoOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {photoLabel(p.id)}
                        </option>
                      ))}
                    </select>
                    <p id={hintId} className="mt-1 max-w-[16rem] text-xs text-gray-600">
                      {feature.verified
                        ? t("host.evidenceVerifiedWarning")
                        : t("host.evidenceHint")}
                    </p>
                  </div>
                  {evidencePreview(draft)}
                  <Button
                    variant="secondary"
                    className="min-h-[44px]"
                    disabled={!dirty}
                    busy={busy === `evidence-${feature.id}`}
                    onClick={() => void saveEvidence(feature, draft)}
                    aria-label={t("host.saveEvidenceLabel", { name: t(`codes.${feature.code}`) })}
                  >
                    {t("host.saveEvidence")}
                  </Button>
                  {feature.evidencePhotoUrl && (
                    <a
                      href={feature.evidencePhotoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] underline ${focusRing}`}
                    >
                      {t("host.viewEvidence")}
                    </a>
                  )}
                  <Button
                    variant="danger"
                    className="min-h-[44px]"
                    busy={busy === `delete-${feature.id}`}
                    onClick={() => void remove(feature)}
                    aria-label={t("host.deleteLabel", { name: t(`codes.${feature.code}`) })}
                  >
                    {t("host.delete")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 grid gap-3 border-t border-gray-200 pt-4 sm:grid-cols-2">
        <h3 className="text-base font-semibold text-gray-900 sm:col-span-2">
          {t("host.addTitle")}
        </h3>
        <Field id="a11y-code" label={t("host.code")}>
          <select
            id="a11y-code"
            value={code}
            onChange={(e) => setCode(e.target.value as AccessibilityCodeValue)}
            className={inputClass}
          >
            {ACCESSIBILITY_CODES.map((c) => (
              <option key={c} value={c}>
                {t(`codes.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="a11y-room" label={t("host.scope")}>
          <select id="a11y-room" name="roomTypeId" defaultValue="" className={inputClass}>
            <option value="">{t("wholeProperty")}</option>
            {property?.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {t("roomType", { name: r.name })}
              </option>
            ))}
          </select>
        </Field>
        {code === WIDTH_CODE && (
          <Field
            id="a11y-width"
            label={t("host.widthCm")}
            hint={t("host.widthRange", { min: MIN_WIDTH_CM, max: MAX_WIDTH_CM })}
            error={widthError}
          >
            <input
              id="a11y-width"
              name="widthCm"
              type="number"
              inputMode="numeric"
              min={MIN_WIDTH_CM}
              max={MAX_WIDTH_CM}
              className={inputClass}
            />
          </Field>
        )}
        <Field id="a11y-evidence" label={t("evidence")} hint={t("host.evidenceHint")}>
          <select
            id="a11y-evidence"
            name="evidencePhotoId"
            value={addEvidence}
            onChange={(e) => setAddEvidence(e.target.value)}
            className={inputClass}
          >
            <option value="">{t("host.noEvidence")}</option>
            {photoOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {photoLabel(p.id)}
              </option>
            ))}
          </select>
        </Field>
        {addEvidence && <div className="sm:col-span-2">{evidencePreview(addEvidence)}</div>}
        <div className="sm:col-span-2">
          <Field id="a11y-note" label={t("host.note")}>
            <textarea id="a11y-note" name="note" maxLength={500} rows={2} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!propertyId} busy={busy === "add"}>
            {t("host.add")}
          </Button>
        </div>
      </form>
      <Status error={status.error} message={status.message} />
      {confirmDialog}
    </Card>
  );
}
