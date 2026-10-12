"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
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
  focusRing,
  inputClass,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useFormat } from "@/i18n/use-format";
import { HOST_PHOTOS_CHANGED_EVENT } from "./host-photos-changed";

/**
 * P2-1a / P1-13(e): ev sahibi erişilebilirlik beyanları — özellik ekle, kanıt fotoğrafı bağla,
 * genişlik/not düzenle, sil. Kanıt, kod ya da genişlik değişince doğrulama DB tetiğiyle düşer
 * (not değişimi düşürmez); yayında yalnız doğrulanmışlar.
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
  /** Yükleme zamanı (ISO); seçeneklerde fotoğrafı ayırt etmek için gösterilir. */
  createdAt?: string;
}

interface PropertyRef {
  id: string;
  title: string;
  rooms: ReadonlyArray<{ id: string; name: string }>;
}

interface PanelStatus {
  error?: string;
  message?: string;
  /** Satıra ait sonuç (kanıt/düzenleme/silme hatası) o satırda gösterilir. */
  rowId?: string;
  /** Silme başarısı: satır kalktığından sonuç listenin hemen altında gösterilir. */
  inList?: boolean;
}

/** Not alanı üst sınırı (API ile aynı). */
const NOTE_MAX = 500;

/** Silme sonrası odak hedefleri (satır kalkınca odak `body`'ye düşmesin). */
const EMPTY_ID = "a11y-features-empty";
const featureNameId = (id: string) => `a11y-feature-${id}`;

const EVIDENCE_OPTION_CLASS =
  "flex min-h-[44px] cursor-pointer items-center gap-2 rounded border border-gray-200 p-1.5 text-xs text-gray-800 has-[:checked]:bg-blue-50 has-[:checked]:font-semibold";

/**
 * Kanıt seçimi: "Kanıt yok" ve ilanın her fotoğrafı için küçük resimli bir radyo düğmesi.
 * Seçim yalnız `onChange`'e bildirilir; gönderim çağıranın işidir (WCAG 3.2.2).
 */
function EvidencePicker({
  name,
  legend,
  hint,
  hintId,
  value,
  onChange,
  photos,
  photoLabel,
  noneLabel,
}: {
  name: string;
  legend: ReactNode;
  hint: string;
  hintId: string;
  value: string;
  onChange: (value: string) => void;
  photos: ReadonlyArray<Photo>;
  photoLabel: (id: string) => string;
  noneLabel: string;
}) {
  return (
    <fieldset aria-describedby={hintId} className="min-w-0">
      <legend className="text-xs font-medium text-gray-800">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        <label className={EVIDENCE_OPTION_CLASS}>
          <input
            type="radio"
            name={name}
            value=""
            checked={value === ""}
            onChange={() => onChange("")}
            className="h-4 w-4 shrink-0"
          />
          {noneLabel}
        </label>
        {photos.map((p) => (
          <label key={p.id} className={EVIDENCE_OPTION_CLASS}>
            <input
              type="radio"
              name={name}
              value={p.id}
              checked={value === p.id}
              onChange={() => onChange(p.id)}
              className="h-4 w-4 shrink-0"
            />
            {/* Görünür etiket adı verir; küçük resim yalnız görsel ayırt etme içindir. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- kanıt küçük resmi */}
            <img
              src={p.url}
              alt=""
              loading="lazy"
              className="h-16 w-16 shrink-0 rounded object-cover"
            />
            <span className="max-w-[9rem]">{photoLabel(p.id)}</span>
          </label>
        ))}
      </div>
      <p id={hintId} className="mt-1 text-xs text-gray-600">
        {hint}
      </p>
    </fieldset>
  );
}

/** Boş genişlik geçerlidir (isteğe bağlı); doluysa aralık içinde tam sayı olmalı. */
function parseWidth(
  input: HTMLInputElement | null
): { ok: true; value: number | null } | { ok: false } {
  if (!input) return { ok: true, value: null };
  if (input.validity.badInput) return { ok: false };
  const raw = input.value.trim();
  if (!raw) return { ok: true, value: null };
  const n = Number(raw);
  return Number.isInteger(n) && n >= MIN_WIDTH_CM && n <= MAX_WIDTH_CM
    ? { ok: true, value: n }
    : { ok: false };
}

export default function AccessibilityPanel({
  properties,
}: {
  properties: ReadonlyArray<PropertyRef>;
}) {
  const t = useTranslations("compliance.accessibility");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const fmt = useFormat();
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "");
  const property = properties.find((p) => p.id === propertyId);
  // Aynı sayfadaki fotoğraf yükleme/silme kanıt seçeneklerini (ve düşen kanıtları) yeniler.
  const [photosVersion, setPhotosVersion] = useState(0);
  useEffect(() => {
    const bump = () => setPhotosVersion((v) => v + 1);
    window.addEventListener(HOST_PHOTOS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(HOST_PHOTOS_CHANGED_EVENT, bump);
  }, []);
  // useLoader yeni istek sürerken eski veriyi tutar; veri istendiği ilanla eşleşmezse
  // önceki ilanın listesi yerine "yükleniyor" gösterilir.
  const features = useLoader(
    () =>
      propertyId
        ? apiFetch<{ features: Feature[] }>(
            `/api/host/properties/${propertyId}/accessibility`
          ).then((r) => ({ propertyId, list: r.features }))
        : Promise.resolve({ propertyId, list: [] as Feature[] }),
    [propertyId, photosVersion]
  );
  const photos = useLoader(
    () =>
      propertyId
        ? apiFetch<{ photos: Photo[] }>(`/api/host/properties/${propertyId}/photos`).then((r) => ({
            propertyId,
            list: r.photos,
          }))
        : Promise.resolve({ propertyId, list: [] as Photo[] }),
    [propertyId, photosVersion]
  );
  const featureList = features.data?.propertyId === propertyId ? features.data.list : null;
  const photoList = photos.data?.propertyId === propertyId ? photos.data.list : null;
  const listLoading = featureList === null && !features.error;
  const [status, setStatus] = useState<PanelStatus>({});
  const [pickedCode, setPickedCode] = useState<AccessibilityCodeValue | null>(null);
  const [scope, setScope] = useState("");
  const [widthError, setWidthError] = useState<string | null>(null);
  // Satır içi kanıt seçimi yalnız yerel taslaktır; "Kanıtı kaydet" ile gönderilir (WCAG 3.2.2).
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addEvidence, setAddEvidence] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editWidthError, setEditWidthError] = useState<string | null>(null);
  const [noteLength, setNoteLength] = useState(0);
  const [editNoteLength, setEditNoteLength] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  // Silinen satırın komşusu (ya da boş liste metni); yeni liste çizilince odak buraya geçer.
  const focusAfterReload = useRef<string | null>(null);

  useEffect(() => {
    const target = focusAfterReload.current;
    if (!target || !featureList) return;
    focusAfterReload.current = null;
    document.getElementById(target)?.focus();
  }, [featureList]);

  const photoOptions = photoList ?? [];
  const photosEmpty = photoList !== null && photoList.length === 0;
  // Sıra numarasına yükleme zamanı eklenir; ev sahibi fotoğrafı seçenekten ayırt edebilir.
  const photoLabel = (id: string) => {
    const i = photoOptions.findIndex((p) => p.id === id);
    const createdAt = photoOptions[i]?.createdAt;
    const index = String(i + 1);
    return createdAt
      ? t("host.photoOptionDated", { index, date: fmt.dateTime(createdAt) })
      : t("host.photoOption", { index });
  };

  const scopeLabel = (feature: Feature) =>
    feature.roomTypeName ? t("roomType", { name: feature.roomTypeName }) : t("host.wholeListing");
  /** Aynı kod hem ilan hem oda için olabilir; satır içi etiketler kapsamı da söyler. */
  const scopedName = (feature: Feature) =>
    t("host.featureScoped", { name: t(`codes.${feature.code}`), scope: scopeLabel(feature) });

  /** Seçili kapsamda zaten beyan edilmiş kodlar (benzersizlik: ilan + oda tipi + kod). */
  const declared = new Set(
    (featureList ?? []).filter((f) => (f.roomTypeId ?? "") === scope).map((f) => f.code)
  );
  // Ev sahibi seçmediyse kapsamda henüz eklenmemiş ilk özellik önerilir (hazır seçim çakışmaz).
  const code =
    pickedCode ?? ACCESSIBILITY_CODES.find((c) => !declared.has(c)) ?? ACCESSIBILITY_CODES[0];
  const duplicate = declared.has(code);
  const widthRangeText = t("host.widthRange", { min: MIN_WIDTH_CM, max: MAX_WIDTH_CM });
  // Kalan karakter aria-describedby ile bağlı ipucunda; canlı bölge değil (her tuşta okunmaz).
  const noteLimit = (length: number) =>
    t("host.noteHint", { max: NOTE_MAX, remaining: NOTE_MAX - length });

  function changeProperty(id: string) {
    setPropertyId(id);
    setPickedCode(null);
    setScope("");
    setAddEvidence("");
    setDrafts({});
    setEditing(null);
    setEditWidthError(null);
    setWidthError(null);
    setStatus({});
  }

  async function run(
    key: string,
    fn: () => Promise<unknown>,
    ok: string,
    row?: { id: string; successInRow?: boolean; successInList?: boolean }
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setStatus({});
    try {
      await fn();
      setStatus({
        message: ok,
        rowId: row?.successInRow ? row.id : undefined,
        inList: row?.successInList,
      });
      features.reload();
      return true;
    } catch (err) {
      setStatus({ error: errorText(err), rowId: row?.id });
      return false;
    } finally {
      setBusy(null);
    }
  }

  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    if (duplicate) {
      document.getElementById("a11y-code")?.focus();
      return;
    }
    const isWidth = code === WIDTH_CODE;
    const widthInput = isWidth
      ? (form.elements.namedItem("widthCm") as HTMLInputElement | null)
      : null;
    const width = parseWidth(widthInput);
    if (!width.ok) {
      setWidthError(widthRangeText);
      widthInput?.focus();
      return;
    }
    setWidthError(null);
    const widthCm = width.value;
    const f = new FormData(form);
    void run(
      "add",
      async () => {
        await apiFetch(`/api/host/properties/${propertyId}/accessibility`, {
          method: "POST",
          body: JSON.stringify({
            code,
            roomTypeId: scope || null,
            widthCm: isWidth ? widthCm : null,
            note: String(f.get("note") ?? "").trim() || null,
            evidencePhotoId: addEvidence || null,
          }),
        });
        form.reset();
        setNoteLength(0);
        setAddEvidence("");
        setScope("");
        setPickedCode(null);
      },
      t("host.added")
    );
  }

  async function saveEvidence(feature: Feature, photoId: string) {
    const name = scopedName(feature);
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
      t("host.evidenceSaved", { name }),
      { id: feature.id, successInRow: true }
    );
    if (ok)
      setDrafts((d) => {
        const next = { ...d };
        delete next[feature.id];
        return next;
      });
  }

  function closeEdit(id: string) {
    setEditing(null);
    setEditWidthError(null);
    requestAnimationFrame(() => document.getElementById(`a11y-edit-${id}`)?.focus());
  }

  async function saveEdit(e: FormEvent<HTMLFormElement>, feature: Feature) {
    e.preventDefault();
    const form = e.currentTarget;
    const isWidth = feature.code === WIDTH_CODE;
    const widthInput = isWidth
      ? (form.elements.namedItem("widthCm") as HTMLInputElement | null)
      : null;
    const width = parseWidth(widthInput);
    if (!width.ok) {
      setEditWidthError(widthRangeText);
      widthInput?.focus();
      return;
    }
    setEditWidthError(null);
    const widthCm = width.value;
    const note = String(new FormData(form).get("note") ?? "").trim();
    const name = scopedName(feature);
    if (
      isWidth &&
      feature.verified &&
      widthCm !== feature.widthCm &&
      !(await confirm({
        title: t("host.editConfirmTitle", { name }),
        body: t("host.widthVerifiedWarning"),
        confirmLabel: t("host.saveEdit"),
        tone: "danger",
      }))
    )
      return;
    const ok = await run(
      `edit-${feature.id}`,
      () =>
        apiFetch(`/api/host/properties/${propertyId}/accessibility/${feature.id}`, {
          method: "PATCH",
          body: JSON.stringify({ note: note || null, ...(isWidth ? { widthCm } : {}) }),
        }),
      t("host.editSaved"),
      { id: feature.id, successInRow: true }
    );
    if (ok) closeEdit(feature.id);
  }

  async function remove(feature: Feature) {
    const name = t(`codes.${feature.code}`);
    const list = featureList ?? [];
    const index = list.findIndex((f) => f.id === feature.id);
    const neighbour = list[index + 1] ?? (index > 0 ? list[index - 1] : undefined);
    if (
      !(await confirm({
        title: t("host.deleteConfirmTitle", { name, scope: scopeLabel(feature) }),
        body: feature.verified ? t("host.deleteConfirmVerified") : t("host.deleteConfirmBody"),
        confirmLabel: t("host.deleteConfirm"),
        tone: "danger",
      }))
    )
      return;
    focusAfterReload.current = neighbour ? featureNameId(neighbour.id) : EMPTY_ID;
    const ok = await run(
      `delete-${feature.id}`,
      () =>
        apiFetch(`/api/host/properties/${propertyId}/accessibility/${feature.id}`, {
          method: "DELETE",
        }),
      t("host.deleted", { name: scopedName(feature) }),
      { id: feature.id, successInList: true }
    );
    if (!ok) focusAfterReload.current = null;
  }

  /** İlan kartındaki "Fotoğraflar" bölümünü açıp dosya seçiciye odaklanır. */
  function openPhotoUpload(e: MouseEvent<HTMLAnchorElement>) {
    const card = document.getElementById(`prop-${propertyId}`);
    const details = card?.querySelector("details");
    if (!card || !details) return;
    e.preventDefault();
    details.open = true;
    let tries = 0;
    const focusInput = () => {
      const input = document.getElementById(`photo-${propertyId}`);
      if (input) {
        input.scrollIntoView({ block: "center" });
        input.focus();
      } else if (++tries < 30) {
        requestAnimationFrame(focusInput);
      } else {
        card.scrollIntoView();
      }
    };
    requestAnimationFrame(focusInput);
  }

  if (properties.length === 0) return null;

  return (
    <Card title={t("host.title")} id="host-accessibility">
      <p className="mb-3 text-sm text-gray-700">{t("host.intro")}</p>
      {properties.length > 1 && (
        <Field id="a11y-property" label={t("host.property")}>
          <select
            id="a11y-property"
            value={propertyId}
            onChange={(e) => changeProperty(e.target.value)}
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
        {listLoading && <p className="text-sm text-gray-600">{t("host.loading")}</p>}
      </div>
      {featureList?.length === 0 && (
        <p id={EMPTY_ID} tabIndex={-1} className="mt-2 text-sm text-gray-700">
          {t("host.empty")}
        </p>
      )}
      {featureList && featureList.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-200" aria-label={t("host.listLabel")}>
          {featureList.map((feature) => {
            const name = t(`codes.${feature.code}`);
            const fullName = scopedName(feature);
            const saved = feature.evidencePhotoId ?? "";
            const draft = drafts[feature.id] ?? saved;
            const dirty = draft !== saved;
            const hintId = `a11y-evidence-${feature.id}-hint`;
            const isEditing = editing === feature.id;
            const editFormId = `a11y-edit-form-${feature.id}`;
            const rowStatus = status.rowId === feature.id ? status : null;
            return (
              <li key={feature.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      id={featureNameId(feature.id)}
                      tabIndex={-1}
                      className="font-medium text-gray-900"
                    >
                      {name}
                      {feature.widthCm !== null && (
                        <span className="font-normal text-gray-700">
                          {" "}
                          · {t("width", { width: feature.widthCm })}
                        </span>
                      )}
                    </p>
                    <p className="text-gray-700">{scopeLabel(feature)}</p>
                    {feature.note && (
                      <p className="mt-1 whitespace-pre-line break-words text-gray-700">
                        {t("host.noteShown", { note: feature.note })}
                      </p>
                    )}
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
                    <p className="mt-1 text-xs text-gray-600">
                      {feature.verified
                        ? t("host.verifiedStatusHint")
                        : feature.evidencePhotoId
                          ? t("host.pendingReviewHint")
                          : t("host.needsEvidenceHint")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {feature.evidencePhotoUrl && (
                      <a
                        href={feature.evidencePhotoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] underline ${focusRing}`}
                      >
                        {t("host.viewEvidence")}
                        <span className="sr-only">
                          : {fullName} {t("host.newTab")}
                        </span>
                        <span aria-hidden="true" className="ml-1">
                          {"↗"}
                        </span>
                      </a>
                    )}
                    <Button
                      id={`a11y-edit-${feature.id}`}
                      variant="secondary"
                      className="min-h-[44px]"
                      aria-expanded={isEditing}
                      aria-controls={isEditing ? editFormId : undefined}
                      aria-label={t("host.editLabel", { name: fullName })}
                      onClick={() => {
                        setEditWidthError(null);
                        setEditNoteLength(feature.note?.length ?? 0);
                        setEditing(isEditing ? null : feature.id);
                      }}
                    >
                      {t("host.edit")}
                    </Button>
                    <Button
                      variant="danger"
                      className="min-h-[44px]"
                      busy={busy === `delete-${feature.id}`}
                      onClick={() => void remove(feature)}
                      aria-label={t("host.deleteLabel", { name: fullName })}
                    >
                      {t("host.delete")}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <EvidencePicker
                    name={`a11y-evidence-${feature.id}`}
                    legend={
                      <>
                        {t("evidence")}
                        <span className="sr-only">: {fullName}</span>
                      </>
                    }
                    hint={
                      photosEmpty
                        ? t("host.noPhotosHint")
                        : feature.verified
                          ? t("host.evidenceVerifiedWarning")
                          : t("host.evidenceHint")
                    }
                    hintId={hintId}
                    value={draft}
                    onChange={(value) => setDrafts((d) => ({ ...d, [feature.id]: value }))}
                    photos={photoOptions}
                    photoLabel={photoLabel}
                    noneLabel={t("host.noEvidence")}
                  />
                  <Button
                    variant="secondary"
                    className="min-h-[44px]"
                    disabled={!dirty}
                    busy={busy === `evidence-${feature.id}`}
                    onClick={() => void saveEvidence(feature, draft)}
                    aria-label={t("host.saveEvidenceLabel", { name: fullName })}
                  >
                    {t("host.saveEvidence")}
                  </Button>
                </div>
                {isEditing && (
                  <form
                    id={editFormId}
                    noValidate
                    onSubmit={(e) => void saveEdit(e, feature)}
                    aria-label={t("host.editLabel", { name: fullName })}
                    className="mt-3 grid gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-2"
                  >
                    {feature.code === WIDTH_CODE && (
                      <Field
                        id={`a11y-edit-width-${feature.id}`}
                        label={t("host.widthCm")}
                        hint={t("host.editWidthHint", { min: MIN_WIDTH_CM, max: MAX_WIDTH_CM })}
                        error={editWidthError}
                      >
                        <input
                          id={`a11y-edit-width-${feature.id}`}
                          name="widthCm"
                          type="number"
                          inputMode="numeric"
                          min={MIN_WIDTH_CM}
                          max={MAX_WIDTH_CM}
                          defaultValue={feature.widthCm ?? ""}
                          className={inputClass}
                        />
                      </Field>
                    )}
                    <div className="sm:col-span-2">
                      <Field
                        id={`a11y-edit-note-${feature.id}`}
                        label={t("host.note")}
                        hint={`${t("host.editNoteHint")} ${noteLimit(editNoteLength)}`}
                      >
                        <textarea
                          id={`a11y-edit-note-${feature.id}`}
                          name="note"
                          maxLength={NOTE_MAX}
                          rows={2}
                          defaultValue={feature.note ?? ""}
                          onChange={(e) => setEditNoteLength(e.target.value.length)}
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-2 sm:col-span-2">
                      <Button
                        type="submit"
                        className="min-h-[44px]"
                        busy={busy === `edit-${feature.id}`}
                      >
                        {t("host.saveEdit")}
                      </Button>
                      <Button
                        variant="secondary"
                        className="min-h-[44px]"
                        onClick={() => closeEdit(feature.id)}
                      >
                        {t("host.cancelEdit")}
                      </Button>
                    </div>
                  </form>
                )}
                {/* Satır sonucu işlemin yanında; canlı bölge boşken de DOM'da kalır. */}
                <div role="status">
                  {rowStatus?.message && !rowStatus.error && (
                    <p className="mt-1 text-green-800">
                      <span aria-hidden="true">{"✓"} </span>
                      {rowStatus.message}
                    </p>
                  )}
                </div>
                {rowStatus?.error && (
                  <p role="alert" className="mt-1 text-red-700">
                    <span aria-hidden="true">{"⚠︎"} </span>
                    <span className="sr-only">{tc("errorPrefix")} </span>
                    {rowStatus.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {/* Silinen satır listeden kalkar; sonuç listenin yerinde duyurulur. */}
      <div role="status">
        {status.inList && status.message && !status.error && (
          <p className="mt-2 text-sm text-green-800">
            <span aria-hidden="true">{"✓"} </span>
            {status.message}
          </p>
        )}
      </div>

      <form
        onSubmit={add}
        noValidate
        aria-labelledby="a11y-add-title"
        className="mt-4 grid gap-3 border-t border-gray-200 pt-4 sm:grid-cols-2"
      >
        <h3 id="a11y-add-title" className="text-base font-semibold text-gray-900 sm:col-span-2">
          {t("host.addTitle")}
        </h3>
        <Field
          id="a11y-code"
          label={t("host.code")}
          error={duplicate ? t("host.alreadyAdded") : null}
        >
          <select
            id="a11y-code"
            value={code}
            onChange={(e) => {
              setPickedCode(e.target.value as AccessibilityCodeValue);
              setWidthError(null);
            }}
            className={inputClass}
          >
            {ACCESSIBILITY_CODES.map((c) => (
              <option key={c} value={c} disabled={declared.has(c)}>
                {declared.has(c)
                  ? t("host.alreadyAddedOption", { name: t(`codes.${c}`) })
                  : t(`codes.${c}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="a11y-room" label={t("host.scope")}>
          <select
            id="a11y-room"
            name="roomTypeId"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className={inputClass}
          >
            <option value="">{t("host.wholeListing")}</option>
            {property?.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {t("roomType", { name: r.name })}
              </option>
            ))}
          </select>
        </Field>
        {code === WIDTH_CODE && (
          <Field id="a11y-width" label={t("host.widthCm")} hint={widthRangeText} error={widthError}>
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
        <div className="sm:col-span-2">
          <EvidencePicker
            name="evidencePhotoId"
            legend={t("evidence")}
            hint={photosEmpty ? t("host.noPhotosHint") : t("host.evidenceHint")}
            hintId="a11y-evidence-hint"
            value={addEvidence}
            onChange={setAddEvidence}
            photos={photoOptions}
            photoLabel={photoLabel}
            noneLabel={t("host.noEvidence")}
          />
          {photosEmpty && propertyId && (
            <a
              href={`#prop-${propertyId}`}
              onClick={openPhotoUpload}
              className={`inline-flex min-h-[44px] items-center text-sm font-semibold text-[#003580] underline ${focusRing}`}
            >
              {t("host.uploadPhotos")}
            </a>
          )}
        </div>
        <div className="sm:col-span-2">
          <Field id="a11y-note" label={t("host.note")} hint={noteLimit(noteLength)}>
            <textarea
              id="a11y-note"
              name="note"
              maxLength={NOTE_MAX}
              rows={2}
              onChange={(e) => setNoteLength(e.target.value.length)}
              className={inputClass}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={!propertyId || listLoading} busy={busy === "add"}>
            {busy === "add" ? t("host.adding") : t("host.add")}
          </Button>
        </div>
      </form>
      <Status
        error={status.rowId ? null : status.error}
        message={status.rowId || status.inList ? null : status.message}
      />
      {confirmDialog}
    </Card>
  );
}
