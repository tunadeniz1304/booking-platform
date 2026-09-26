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

  const photoOptions = photos.data ?? [];
  const photoLabel = (id: string) =>
    t("host.photoOption", { index: String(photoOptions.findIndex((p) => p.id === id) + 1) });

  async function run(fn: () => Promise<unknown>, ok: string) {
    setStatus({});
    try {
      await fn();
      setStatus({ message: ok });
      features.reload();
    } catch (err) {
      setStatus({ error: errorMessage(err) });
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
    void run(async () => {
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
    }, t("host.added"));
  }

  const setEvidence = (feature: Feature, photoId: string) =>
    run(
      () =>
        apiFetch(`/api/host/properties/${propertyId}/accessibility/${feature.id}`, {
          method: "PATCH",
          body: JSON.stringify({ evidencePhotoId: photoId || null }),
        }),
      t("host.evidenceSaved")
    );

  const remove = (feature: Feature) =>
    run(
      () =>
        apiFetch(`/api/host/properties/${propertyId}/accessibility/${feature.id}`, {
          method: "DELETE",
        }),
      t("host.deleted")
    );

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
      {features.data === null && !features.error && (
        <p aria-live="polite" className="text-sm text-gray-600">
          {t("host.loading")}
        </p>
      )}
      {features.data?.length === 0 && (
        <p className="mt-2 text-sm text-gray-700">{t("host.empty")}</p>
      )}
      {features.data && features.data.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-200" aria-label={t("host.listLabel")}>
          {features.data.map((feature) => (
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
                    value={feature.evidencePhotoId ?? ""}
                    onChange={(e) => void setEvidence(feature, e.target.value)}
                    className={`${inputClass} min-h-[2.5rem]`}
                  >
                    <option value="">{t("host.noEvidence")}</option>
                    {photoOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {photoLabel(p.id)}
                      </option>
                    ))}
                  </select>
                </div>
                {feature.evidencePhotoUrl && (
                  <a
                    href={feature.evidencePhotoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex min-h-[2.5rem] items-center text-sm font-semibold text-[#003580] underline ${focusRing}`}
                  >
                    {t("host.viewEvidence")}
                  </a>
                )}
                <Button
                  variant="danger"
                  onClick={() => void remove(feature)}
                  aria-label={t("host.deleteLabel", { name: t(`codes.${feature.code}`) })}
                >
                  {t("host.delete")}
                </Button>
              </div>
            </li>
          ))}
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
          <select id="a11y-evidence" name="evidencePhotoId" defaultValue="" className={inputClass}>
            <option value="">{t("host.noEvidence")}</option>
            {photoOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {photoLabel(p.id)}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field id="a11y-note" label={t("host.note")}>
            <textarea id="a11y-note" name="note" maxLength={500} rows={2} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!propertyId}>
            {t("host.add")}
          </Button>
        </div>
      </form>
      <Status error={status.error} message={status.message} />
    </Card>
  );
}
