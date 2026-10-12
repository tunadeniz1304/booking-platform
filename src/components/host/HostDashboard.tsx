"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { isoDay } from "@/lib/ui/format";
import { parseAmountToMinor } from "@/lib/ui/amount-input";
import { useFormat } from "@/i18n/use-format";
import {
  Button,
  Card,
  Field,
  LlmBadge,
  Status,
  focusRing,
  inputClass,
  useErrorText,
  useLoader,
} from "@/components/ui/ui";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import DepositSettings from "./DepositSettings";
import PromotionsPanel from "./PromotionsPanel";
import AccessibilityPanel from "./AccessibilityPanel";
import { hasHostUnsavedChanges, useHostUnsavedChanges } from "./useHostUnsavedChanges";
import { CURRENCIES, toMajorNumber } from "@/lib/money/money";
import { BED_TYPES, DEFAULT_BED_TYPE } from "@/lib/i18n/bed-type";

/** API sözleşmesi: `listHostProperties` oda seçimi (maxOccupancy + units) ile aynı (F526). */
interface HostRoom {
  id: string;
  name: string;
  maxOccupancy: number;
  units: number;
  available: boolean;
}

interface HostProperty {
  id: string;
  title: string;
  description: string;
  isActive: boolean;
  licenseNumber: string | null;
  licenseStatus: "PENDING" | "VERIFIED" | "REJECTED";
  basePriceMinor: number;
  currency: string;
  ratingAvg: number;
  rooms: HostRoom[];
}

interface HostBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  totalPriceMinor: number;
  currency: string;
  propertyId: string;
  roomId: string;
  guestCount: number;
  /** API eklediğinde gösterilir (F834). */
  guestName?: string | null;
}

const BOOKING_STATUSES = [
  "PENDING",
  "HELD",
  "CONFIRMED",
  "CANCELLED",
  "EXPIRED",
  "COMPLETED",
] as const;

const PROPERTY_TYPES = ["HOTEL", "APARTMENT", "VILLA", "HOSTEL", "BED_AND_BREAKFAST"] as const;

/** Bu sayıdan fazla ilan varsa başlığa göre süzme alanı gösterilir. */
const FILTER_THRESHOLD = 5;

/** Toplu takvimde tek istekte izin verilen en uzun aralık (host-service bulkUpdateAvailability). */
const MAX_CALENDAR_NIGHTS = 365;
/** Bu sayıdan uzun aralıkta toplu takvim değişikliği özetle onaylatılır (F845). */
const BULK_CONFIRM_NIGHTS = 31;

/** Sunucu varsayılanları (app-config VISION_*); GET yanıtı `limits` döndürürse o kullanılır. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const DEFAULT_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Kalite skoru seviyeleri (0–100); düşük sınır VISION_LOW_QUALITY_THRESHOLD varsayılanı. */
const QUALITY_LOW_BELOW = 35;
const QUALITY_GOOD_FROM = 70;

/** İlan açıklaması uzunluk sınırı (host-service şeması). */
const DESCRIPTION_MAX = 5000;
/** Sayaç ekran okuyucuya yalnız sınıra bu kadar karakter kala duyurulur; her tuşta değil. */
const DESCRIPTION_ANNOUNCE_REMAINING = 200;

/** Mülk kartı başlığının (Card h2) id'si; alt formların adını mülke bağlamak için (F527). */
function propertyHeadingId(propertyId: string): string {
  return `prop-${propertyId}-title`;
}

/** YYYY-MM-DD aralığındaki gece sayısı (bitiş dahil); geçersizse null. */
function nightsInclusive(from: string, to: string): number | null {
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) + 1 : null;
}

/** YYYY-MM-DD tarihine gün ekler (UTC); geçersizse undefined. */
function addIsoDays(day: string, days: number): string | undefined {
  const ms = Date.parse(day);
  return Number.isFinite(ms)
    ? new Date(ms + days * 86_400_000).toISOString().slice(0, 10)
    : undefined;
}

const linkClass = `text-sm font-semibold text-[#003580] hover:underline ${focusRing}`;
/** Mobilde ≥44px dokunma hedefi; masaüstünde mevcut yoğunluk korunur. */
const navLinkClass = `inline-flex min-h-[44px] items-center sm:min-h-[24px] ${linkClass}`;

type FieldErrors = Record<string, string>;

/** Para birimi için ondalık basamak sayısı (JPY=0, TRY=2 …). */
function fractionDigitsOf(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Kullanıcı girişini ("1.500", "1.500,50", "1500.5") minor birime çevirir; geçersizse null. */
function parseMinor(input: string, currency: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  return parseAmountToMinor(trimmed, fractionDigitsOf(currency));
}

/** İstek sözleşmesi ana birim bekler (ör. 1500.5). */
function minorToMajor(minor: number, currency: string): number {
  return minor / 10 ** fractionDigitsOf(currency);
}

/** Zod `flatten()` ayrıntısındaki alan hatalarının adları (sunucu metni değil, alan bağı için). */
function serverFieldKeys(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const details = err.details as
    { fieldErrors?: Record<string, unknown[] | undefined> } | undefined;
  return Object.entries(details?.fieldErrors ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k);
}

/** Hatalı alanlardan ilkine odak taşır (alan sırası `order` ile verilir). */
function focusFirstInvalid(errors: FieldErrors, order: ReadonlyArray<[string, string]>) {
  const first = order.find(([key]) => errors[key]);
  if (!first) return;
  requestAnimationFrame(() => document.getElementById(first[1])?.focus());
}

/** Kalite skorunun (0–100) yorumu: "good" | "medium" | "low" (F1309). */
function qualityLevel(score: number): "good" | "medium" | "low" {
  return score >= QUALITY_GOOD_FROM ? "good" : score < QUALITY_LOW_BELOW ? "low" : "medium";
}

/** Açıklama karakter sayacı; ekran okuyucuya yalnız sınıra yaklaşınca duyurulur (F126/F173). */
function DescriptionCount({ length }: { length: number }) {
  const t = useTranslations("host");
  const text = t("property.fields.descriptionCount", { count: length, max: DESCRIPTION_MAX });
  return (
    <>
      <p aria-hidden="true" className="mt-1 text-xs text-gray-600">
        {text}
      </p>
      <p role="status" className="sr-only">
        {length >= DESCRIPTION_MAX - DESCRIPTION_ANNOUNCE_REMAINING ? text : ""}
      </p>
    </>
  );
}

export default function HostDashboard() {
  const t = useTranslations("host");
  const tp = useTranslations("payouts");
  const tr = useTranslations("resolution");
  const tt = useTranslations("trust");
  const tNav = useTranslations("nav");
  const tRevenue = useTranslations("revenue");
  const f = useFormat();
  const statusLabel = (s: string) =>
    (BOOKING_STATUSES as readonly string[]).includes(s)
      ? t(`bookingStatus.${s as (typeof BOOKING_STATUSES)[number]}`)
      : s;
  // Uçlar ayrı yüklenir: biri düşerse diğeri çalışmaya devam eder (F279).
  const propertiesLoader = useLoader(() => apiFetch<HostProperty[]>("/api/host/properties"));
  const bookingsLoader = useLoader(() => apiFetch<HostBooking[]>("/api/host/bookings"));
  const properties = propertiesLoader.data;
  const bookings = bookingsLoader.data;
  // İlk yükleme ya da hata sonrası yeniden deneme: henüz gösterilecek veri yok (F1302).
  const propertiesLoading = propertiesLoader.loading && properties === null;
  const bookingsLoading = bookingsLoader.loading && bookings === null;
  const load = propertiesLoader.reload;
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");

  const titleOf = (id: string) => properties?.find((p) => p.id === id)?.title ?? id;
  const query = filter.trim().toLocaleLowerCase();
  const visibleProperties =
    properties?.filter((p) => !query || p.title.toLocaleLowerCase().includes(query)) ?? [];
  const hasProperties = !!properties && properties.length > 0;

  // Rezervasyon süzgeçleri (F834): çok kayıtta durum/mülke göre daraltma.
  const [statusFilter, setStatusFilter] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const showBookingFilters = !!bookings && bookings.length > FILTER_THRESHOLD;
  const bookingStatuses = BOOKING_STATUSES.filter((s) => bookings?.some((b) => b.status === s));
  const bookingPropertyIds = [...new Set(bookings?.map((b) => b.propertyId) ?? [])];
  const visibleBookings =
    bookings?.filter(
      (b) =>
        (!statusFilter || b.status === statusFilter) &&
        (!propertyFilter || b.propertyId === propertyFilter)
    ) ?? [];
  const hasGuestNames = visibleBookings.some((b) => b.guestName);
  const bookingTableClass = visibleBookings.length > 0 ? "md:block" : "";
  /** Kısa rezervasyon no: kimliğin son 8 karakteri. */
  const bookingRef = (id: string) => id.slice(-8);

  // Sayfa içi gezinme `beforeunload` tetiklemez: kaydedilmemiş değişiklikte onay istenir (F839).
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const guardLeave = (href: string) => (e: { preventDefault: () => void }) => {
    if (!hasHostUnsavedChanges()) return;
    e.preventDefault();
    void confirm({
      title: t("unsaved.leaveConfirm.title"),
      body: t("unsaved.leaveConfirm.body"),
      confirmLabel: t("unsaved.leaveConfirm.confirm"),
      cancelLabel: t("unsaved.leaveConfirm.cancel"),
      tone: "danger",
    }).then((ok) => {
      if (ok) router.push(href);
    });
  };

  return (
    <div className="space-y-6">
      {/* Ev sahibi sayfaları (HostPagesNav sırası) + çözüm merkezi; geçerli sayfa işaretli,
          kaydedilmemiş değişiklikte ayrılma onayı korunur (F1124/F1301). */}
      <nav aria-label={t("pagesNav")}>
        <ul className="flex flex-wrap gap-x-4">
          <li>
            <Link
              href="/host"
              aria-current="page"
              className={`${navLinkClass} underline decoration-2 underline-offset-4`}
            >
              {tNav("host")}
            </Link>
          </li>
          <li>
            <Link
              href="/host/revenue"
              className={navLinkClass}
              aria-describedby="host-pages-revenue-hint"
              onNavigate={guardLeave("/host/revenue")}
            >
              {tRevenue("page.title")}
            </Link>
          </li>
          <li>
            <Link
              href="/host/payouts"
              className={navLinkClass}
              onNavigate={guardLeave("/host/payouts")}
            >
              {tp("page.title")}
            </Link>
          </li>
          <li>
            <Link
              href="/resolution"
              className={navLinkClass}
              onNavigate={guardLeave("/resolution")}
            >
              {tr("hostLinkClaims")}
            </Link>
          </li>
          {/* Hasar talebi rezervasyonun mesaj sayfasından açılır; liste bu sayfada (F9). */}
          <li>
            <a href="#host-bookings" className={navLinkClass}>
              {t("dashboard.openClaimLink")}
            </a>
          </li>
        </ul>
        <p id="host-pages-revenue-hint" className="text-xs text-gray-600">
          {t("dashboard.revenueHint")}
        </p>
      </nav>
      {confirmDialog}

      {/* Sayfa içi atlama bağlantıları (F128/F278, WCAG 2.4.1). */}
      <nav aria-label={t("dashboard.sectionsNav")}>
        <ul className="flex flex-wrap gap-x-4">
          <li>
            <a href="#host-bookings" className={navLinkClass}>
              {t("dashboard.navBookings")}
            </a>
          </li>
          <li>
            <a href="#host-properties" className={navLinkClass}>
              {t("dashboard.navProperties")}
            </a>
          </li>
          {hasProperties && (
            <>
              <li>
                <a href="#host-promotions" className={navLinkClass}>
                  {t("dashboard.navPromotions")}
                </a>
              </li>
              <li>
                <a href="#host-accessibility" className={navLinkClass}>
                  {t("dashboard.navAccessibility")}
                </a>
              </li>
            </>
          )}
          {/* Parti riski kartı sayfada bu panelin üstünde (src/app/host/page.tsx). */}
          <li>
            <a href="#host-party-risk" className={navLinkClass}>
              {tt("partyRisk.title")}
            </a>
          </li>
        </ul>
      </nav>

      {/* Sık kullanılan rezervasyonlar ve mesajlar en üstte (F278/F280). */}
      <Card title={t("bookings.title")} id="host-bookings">
        {/* Yükleme durumu hep DOM'da duran bölgede duyurulur; yeniden denemede de (F1302). */}
        <p role="status" className="text-sm text-gray-600">
          {bookingsLoading && t("bookings.loading")}
        </p>
        <div aria-busy={bookingsLoading}>
          {bookingsLoader.error ? (
            <div className="flex flex-wrap items-center gap-3">
              <Status error={t("bookings.error")} />
              <Button
                variant="secondary"
                busy={bookingsLoader.loading}
                onClick={bookingsLoader.reload}
              >
                {t("dashboard.retry")}
              </Button>
            </div>
          ) : bookings === null ? null : bookings.length === 0 ? (
            <p className="text-sm text-gray-700">{t("bookings.empty")}</p>
          ) : (
            <>
              {showBookingFilters && (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 md:max-w-xl">
                  <Field label={t("bookings.filter.status")} id="host-bookings-status">
                    <select
                      id="host-bookings-status"
                      className={inputClass}
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="">{t("bookings.filter.all")}</option>
                      {bookingStatuses.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {bookingPropertyIds.length > 1 && (
                    <Field label={t("bookings.filter.property")} id="host-bookings-property">
                      <select
                        id="host-bookings-property"
                        className={inputClass}
                        value={propertyFilter}
                        onChange={(e) => setPropertyFilter(e.target.value)}
                      >
                        <option value="">{t("bookings.filter.all")}</option>
                        {bookingPropertyIds.map((id) => (
                          <option key={id} value={id}>
                            {titleOf(id)}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <p aria-live="polite" className="text-sm text-gray-700 sm:col-span-2">
                    {visibleBookings.length === 0
                      ? t("bookings.filter.empty")
                      : t("bookings.filter.count", {
                          shown: visibleBookings.length,
                          total: bookings.length,
                        })}
                  </p>
                </div>
              )}
              {/* Mobil: kart listesi, tam genişlik "Mesajlar" bağlantısı. */}
              <ul className="space-y-3 md:hidden">
                {visibleBookings.map((b) => (
                  <li key={b.id} className="rounded-md border border-gray-200 p-3 text-sm">
                    <p className="font-semibold text-gray-900">{titleOf(b.propertyId)}</p>
                    <p className="text-gray-700">
                      {t("bookings.columns.ref")}:{" "}
                      <span className="font-mono">{bookingRef(b.id)}</span>
                      {b.guestName && (
                        <>
                          {" "}
                          · {t("bookings.columns.guestName")}: {b.guestName}
                        </>
                      )}
                    </p>
                    <p className="text-gray-800">
                      {f.date(b.checkIn, "short")} – {f.date(b.checkOut, "short")} ·{" "}
                      {t("bookings.columns.guests")}: {b.guestCount}
                    </p>
                    <p className="text-gray-800">
                      {f.money(b.totalPriceMinor, b.currency)} · {statusLabel(b.status)}
                    </p>
                    {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
                      <Link
                        href={"/host/messages/" + b.id}
                        onNavigate={guardLeave("/host/messages/" + b.id)}
                        className={`mt-2 flex min-h-[44px] w-full items-center justify-center rounded-md border border-gray-200 ${linkClass}`}
                      >
                        {t("bookings.messagesAndClaimsLink")}
                        <span className="sr-only">
                          : {titleOf(b.propertyId)}, {f.date(b.checkIn, "short")}
                        </span>
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              <div
                className={`relative hidden overflow-x-auto ${bookingTableClass}`}
                role="region"
                aria-label={t("bookings.caption")}
                tabIndex={0}
              >
                <table className="min-w-full text-left text-sm">
                  <caption className="sr-only">{t("bookings.caption")}</caption>
                  <thead className="border-b text-gray-700">
                    <tr>
                      <th scope="col" className="py-2 pr-4">
                        {t("bookings.columns.property")}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t("bookings.columns.ref")}
                      </th>
                      {hasGuestNames && (
                        <th scope="col" className="py-2 pr-4">
                          {t("bookings.columns.guestName")}
                        </th>
                      )}
                      {/* API rezervasyonları girişe göre artan sırada döndürür. */}
                      <th scope="col" className="py-2 pr-4" aria-sort="ascending">
                        {t("bookings.columns.checkIn")}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t("bookings.columns.checkOut")}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t("bookings.columns.guests")}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t("bookings.columns.amount")}
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        {t("bookings.columns.status")}
                      </th>
                      <th scope="col" className="py-2">
                        <span className="sr-only">{t("bookings.columns.messages")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBookings.map((b) => (
                      <tr key={b.id} className="border-b last:border-0">
                        <th scope="row" className="py-2 pr-4 text-left font-normal">
                          {titleOf(b.propertyId)}
                        </th>
                        <td className="py-2 pr-4 font-mono">{bookingRef(b.id)}</td>
                        {hasGuestNames && <td className="py-2 pr-4">{b.guestName}</td>}
                        <td className="py-2 pr-4">{f.date(b.checkIn, "short")}</td>
                        <td className="py-2 pr-4">{f.date(b.checkOut, "short")}</td>
                        <td className="py-2 pr-4">{b.guestCount}</td>
                        <td className="py-2 pr-4">{f.money(b.totalPriceMinor, b.currency)}</td>
                        <td className="py-2 pr-4">{statusLabel(b.status)}</td>
                        <td className="py-2">
                          {(b.status === "CONFIRMED" || b.status === "COMPLETED") && (
                            <Link
                              href={"/host/messages/" + b.id}
                              className={linkClass}
                              onNavigate={guardLeave("/host/messages/" + b.id)}
                            >
                              {t("bookings.messagesAndClaimsLink")}
                              <span className="sr-only">
                                : {titleOf(b.propertyId)}, {f.date(b.checkIn, "short")}
                              </span>
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      <section
        id="host-properties"
        className="space-y-6"
        aria-labelledby="host-properties-title"
        aria-busy={propertiesLoading}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="host-properties-title" className="text-lg font-semibold text-gray-900">
            {t("dashboard.propertiesTitle")}
          </h2>
          {hasProperties && !creating && (
            <Button variant="secondary" onClick={() => setCreating(true)}>
              {t("dashboard.createNew")}
            </Button>
          )}
        </div>
        {propertiesLoader.error && (
          <div className="flex flex-wrap items-center gap-3">
            <Status error={propertiesLoader.error} />
            <Button
              variant="secondary"
              busy={propertiesLoader.loading}
              onClick={propertiesLoader.reload}
            >
              {t("dashboard.retry")}
            </Button>
          </div>
        )}
        {/* Hep DOM'da duran durum bölgesi; boşken akıştan çıkar (F1302). */}
        <p role="status" className="text-sm text-gray-600 empty:sr-only">
          {propertiesLoading && t("dashboard.loadingProperties")}
        </p>
        {properties?.length === 0 && !creating && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">{t("dashboard.noProperties")}</p>
            <Button onClick={() => setCreating(true)}>{t("dashboard.createFirst")}</Button>
          </div>
        )}
        {creating && (
          <CreatePropertyForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              load();
            }}
          />
        )}
        {properties && properties.length > FILTER_THRESHOLD && (
          <div className="max-w-sm">
            <Field
              label={t("dashboard.filterLabel")}
              id="host-property-filter"
              hint={t("dashboard.filterHint")}
            >
              <input
                id="host-property-filter"
                type="search"
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </Field>
          </div>
        )}
        <p role="status" className="text-sm text-gray-700 empty:sr-only">
          {hasProperties && visibleProperties.length === 0 && t("dashboard.filterEmpty")}
        </p>
        {visibleProperties.map((p, i) => (
          <PropertyPanel key={p.id} property={p} onChanged={load} defaultOpen={i === 0} />
        ))}
      </section>
      {properties && properties.length > 0 && <PromotionsPanel properties={properties} />}
      {properties && properties.length > 0 && <AccessibilityPanel properties={properties} />}
    </div>
  );
}

function CreatePropertyForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("host");
  const tc = useTranslations("common");
  const errorText = useErrorText();
  const id = "host-create";
  const [form, setForm] = useState(() => ({
    title: "",
    description: "",
    propertyType: "APARTMENT" as (typeof PROPERTY_TYPES)[number],
    city: "",
    country: t("create.defaultCountry"),
    basePrice: "",
    currency: "TRY" as string,
    licenseNumber: "",
    roomName: "",
    roomCapacity: "2",
    roomBedType: DEFAULT_BED_TYPE as string,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [kycRequired, setKycRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  // Yarım kalan yeni ilan formunda sayfadan ayrılırken uyarı (F838).
  useHostUnsavedChanges(form.title.trim() !== "" || form.description.trim() !== "");

  const order: ReadonlyArray<[string, string]> = [
    ["title", `${id}-name`],
    ["description", `${id}-desc`],
    ["propertyType", `${id}-type`],
    ["city", `${id}-city`],
    ["country", `${id}-country`],
    ["basePrice", `${id}-price`],
    ["currency", `${id}-currency`],
    ["licenseNumber", `${id}-license`],
    ["rooms", `${id}-room-name`],
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    setKycRequired(false);
    const priceMinor = parseMinor(form.basePrice, form.currency);
    if (priceMinor === null || priceMinor <= 0) {
      const next = { basePrice: t("property.invalidAmount") };
      setErrors(next);
      focusFirstInvalid(next, order);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        propertyType: form.propertyType,
        city: form.city,
        country: form.country,
        basePrice: minorToMajor(priceMinor, form.currency),
        currency: form.currency,
        rooms: [
          {
            name: form.roomName,
            capacity: Number(form.roomCapacity),
            bedType: form.roomBedType,
          },
        ],
      };
      if (form.licenseNumber.trim()) body.licenseNumber = form.licenseNumber.trim();
      await apiFetch("/api/properties", { method: "POST", body: JSON.stringify(body) });
      setStatus({ message: t("create.created") });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.code === "IDENTITY_VERIFICATION_REQUIRED") {
        setKycRequired(true);
        return;
      }
      const keys = serverFieldKeys(err);
      if (keys.length > 0) {
        const next = Object.fromEntries(keys.map((k) => [k, t("form.fieldInvalid")]));
        setErrors(next);
        setStatus({ error: t("form.fieldErrorsSummary", { count: keys.length }) });
        focusFirstInvalid(next, order);
      } else {
        setStatus({ error: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t("create.title")} id={id}>
      <p className="mb-4 text-sm text-gray-700">{t("create.intro")}</p>
      <form
        onSubmit={submit}
        className="grid gap-4 md:grid-cols-2"
        aria-label={t("create.title")}
        aria-busy={busy}
      >
        <Field
          label={t("property.fields.title")}
          id={`${id}-name`}
          hint={t("property.fields.titleHint")}
          error={errors.title}
        >
          <input
            id={`${id}-name`}
            className={inputClass}
            value={form.title}
            minLength={2}
            maxLength={120}
            required
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={t("create.type")} id={`${id}-type`} error={errors.propertyType}>
          <select
            id={`${id}-type`}
            className={inputClass}
            value={form.propertyType}
            onChange={(e) =>
              setForm({ ...form, propertyType: e.target.value as (typeof PROPERTY_TYPES)[number] })
            }
          >
            {PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`create.types.${type}`)}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field
            label={t("property.fields.description")}
            id={`${id}-desc`}
            hint={t("create.descriptionHint")}
            error={errors.description}
          >
            <textarea
              id={`${id}-desc`}
              rows={4}
              className={inputClass}
              value={form.description}
              minLength={10}
              maxLength={DESCRIPTION_MAX}
              required
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <DescriptionCount length={form.description.length} />
        </div>
        <Field label={t("create.city")} id={`${id}-city`} error={errors.city}>
          <input
            id={`${id}-city`}
            className={inputClass}
            value={form.city}
            autoComplete="address-level2"
            maxLength={100}
            required
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
        </Field>
        <Field label={t("create.country")} id={`${id}-country`} error={errors.country}>
          <input
            id={`${id}-country`}
            className={inputClass}
            value={form.country}
            autoComplete="country-name"
            maxLength={100}
            required
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          />
        </Field>
        <Field
          label={t("create.basePrice")}
          id={`${id}-price`}
          hint={t("property.fields.basePriceHint")}
          error={errors.basePrice}
        >
          <input
            id={`${id}-price`}
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={form.basePrice}
            required
            onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
          />
        </Field>
        <Field label={t("create.currency")} id={`${id}-currency`} error={errors.currency}>
          <select
            id={`${id}-currency`}
            className={inputClass}
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field
            label={t("property.fields.licenseNumberOptional")}
            id={`${id}-license`}
            hint={t("property.fields.licenseHint")}
            error={errors.licenseNumber}
          >
            <input
              id={`${id}-license`}
              className={inputClass}
              value={form.licenseNumber}
              pattern="(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?"
              onChange={(e) => setForm({ ...form, licenseNumber: e.target.value })}
            />
          </Field>
        </div>
        <fieldset className="grid gap-4 md:col-span-2 md:grid-cols-3">
          <legend className="mb-2 text-base font-semibold text-gray-900">
            {t("create.firstRoom")}
          </legend>
          <Field label={t("rooms.add.name")} id={`${id}-room-name`} error={errors.rooms}>
            <input
              id={`${id}-room-name`}
              className={inputClass}
              value={form.roomName}
              required
              maxLength={80}
              onChange={(e) => setForm({ ...form, roomName: e.target.value })}
            />
          </Field>
          <Field
            label={t("rooms.add.capacity")}
            id={`${id}-room-cap`}
            hint={t("rooms.add.capacityHint")}
          >
            <input
              id={`${id}-room-cap`}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              className={inputClass}
              value={form.roomCapacity}
              required
              onChange={(e) => setForm({ ...form, roomCapacity: e.target.value })}
            />
          </Field>
          {/* Sabit kod saklanır; misafire kendi dilinde gösterilir (F1306). */}
          <Field label={t("rooms.add.bedType")} id={`${id}-room-bed`}>
            <select
              id={`${id}-room-bed`}
              className={inputClass}
              value={form.roomBedType}
              required
              onChange={(e) => setForm({ ...form, roomBedType: e.target.value })}
            >
              {BED_TYPES.map((type) => (
                <option key={type} value={type}>
                  {tc(`bedTypes.${type}`)}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          {/* Meşgulken `disabled` yerine `busy`: odak düğmede kalır (F1128). */}
          <Button type="submit" busy={busy}>
            {busy ? t("create.submitting") : t("create.submit")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            aria-disabled={busy}
            onClick={() => {
              if (!busy) onCancel();
            }}
          >
            {t("create.cancel")}
          </Button>
          <Status error={status.error} message={status.message} />
        </div>
        {kycRequired && (
          <div aria-live="polite" className="text-sm text-gray-800 md:col-span-2">
            <p>{t("create.kycRequired")}</p>
            <Link href="/account" className={navLinkClass}>
              {t("create.kycLink")}
            </Link>
          </div>
        )}
      </form>
    </Card>
  );
}

/** Düzenleme formunun sunucu değerlerinden türetilen hali (fiyat ana birimde, istek sözleşmesi). */
function propertyFormValues(p: HostProperty) {
  return {
    title: p.title,
    description: p.description,
    basePrice: String(toMajorNumber(p.basePriceMinor, p.currency)),
    licenseNumber: p.licenseNumber ?? "",
  };
}

type PropertyFormValues = ReturnType<typeof propertyFormValues>;

function PropertyPanel({
  property,
  onChanged,
  defaultOpen,
}: {
  property: HostProperty;
  onChanged: () => void;
  defaultOpen: boolean;
}) {
  const t = useTranslations("host");
  const f = useFormat();
  const { confirm, confirmDialog } = useConfirm();
  const p = property;
  const pid = `prop-${p.id}`;
  const [open, setOpen] = useState(defaultOpen);
  const latest = propertyFormValues(p);
  const [base, setBase] = useState(latest);
  const [form, setForm] = useState(latest);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);
  /** Başarıyla kaydedilen form; sunucu yeniden yüklenene dek "kaydedilmemiş" sayılmaz. */
  const [savedForm, setSavedForm] = useState<PropertyFormValues | null>(null);
  const errorText = useErrorText();
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishStatus, setPublishStatus] = useState<{ error?: string; message?: string }>({});

  // Yeniden yüklemede (kayıt, oda/fotoğraf değişikliği) kullanıcının dokunmadığı alanlar
  // sunucudaki yeni değere eşitlenir; düzenlenmekte olan alanlar korunur (F837).
  if ((Object.keys(latest) as (keyof PropertyFormValues)[]).some((k) => latest[k] !== base[k])) {
    setBase(latest);
    setForm((cur) => {
      const sync = <K extends keyof PropertyFormValues>(k: K) =>
        cur[k] === base[k] ? latest[k] : cur[k];
      return {
        title: sync("title"),
        description: sync("description"),
        basePrice: sync("basePrice"),
        licenseNumber: sync("licenseNumber"),
      };
    });
  }

  // Kart başlığı (h2) `${pid}-title` id'sini kullanır; alan id'leri bununla çakışmamalı (F130/F283).
  const order: ReadonlyArray<[string, string]> = [
    ["title", `${pid}-name`],
    ["basePrice", `${pid}-price`],
    ["description", `${pid}-desc`],
    ["licenseNumber", `${pid}-license`],
  ];
  const priceMinor = parseMinor(form.basePrice, p.currency);
  const license = form.licenseNumber.trim();
  const licenseChanged = license !== "" && license !== (p.licenseNumber ?? "");
  const priceChanged =
    priceMinor === null ? form.basePrice !== latest.basePrice : priceMinor !== p.basePriceMinor;
  // Kaydedilmemiş değişiklik: göstergede, sekme kapatmada ve sayfa içi gezinmede uyarı (F838/F839).
  const dirty =
    form !== savedForm &&
    (form.title !== p.title ||
      form.description !== p.description ||
      priceChanged ||
      licenseChanged);
  useHostUnsavedChanges(dirty);

  /** Düzenleme önceki "Kaydedildi." mesajını kaldırır; yerine kaydedilmemiş uyarısı görünür. */
  function edit(patch: Partial<PropertyFormValues>) {
    setForm((cur) => ({ ...cur, ...patch }));
    if (status.message) setStatus({});
  }

  /** AI taslağını açıklamaya aktarır (kaydetmez) ve düzenleme için alana odaklar (F846/F847). */
  function applyDraft(text: string) {
    edit({ description: text.slice(0, DESCRIPTION_MAX) });
    requestAnimationFrame(() => document.getElementById(`${pid}-desc`)?.focus());
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    if (priceMinor === null || priceMinor <= 0) {
      const next = { basePrice: t("property.invalidAmount") };
      setErrors(next);
      focusFirstInvalid(next, order);
      return;
    }
    setErrors({});
    // Yalnız değişen alanlar gönderilir: ilgisiz düzenleme belge kuralına takılmaz (F837).
    // Yayın durumu bu formda değil, ayrı onaylı düğmeyle değişir (F1126).
    const body: Record<string, unknown> = {};
    if (form.title !== p.title) body.title = form.title;
    if (form.description !== p.description) body.description = form.description;
    if (priceMinor !== p.basePriceMinor) body.basePrice = minorToMajor(priceMinor, p.currency);
    if (licenseChanged) body.licenseNumber = license;
    if (Object.keys(body).length === 0) {
      setStatus({ message: t("property.noChanges") });
      return;
    }
    // Büyük fiyat değişikliğinde (±%50) onay: "1.500" yerine "1,5" gibi yazım hatalarını yakalar.
    const ratio = priceMinor / p.basePriceMinor;
    if (
      p.basePriceMinor > 0 &&
      (ratio < 0.5 || ratio > 1.5) &&
      !(await confirm({
        title: t("property.priceConfirm.title"),
        body: t("property.priceConfirm.body", {
          from: f.money(p.basePriceMinor, p.currency),
          to: f.money(priceMinor, p.currency),
        }),
        confirmLabel: t("property.priceConfirm.confirm"),
        tone: "primary",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/properties/${p.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setStatus({ message: t("property.saved") });
      setSavedForm(form);
      onChanged();
    } catch (err) {
      const keys = serverFieldKeys(err);
      if (keys.length > 0) {
        const next = Object.fromEntries(keys.map((k) => [k, t("form.fieldInvalid")]));
        setErrors(next);
        setStatus({ error: t("form.fieldErrorsSummary", { count: keys.length }) });
        focusFirstInvalid(next, order);
      } else {
        setStatus({ error: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  /** Yayına alma/kaldırma: düzenleme formundan ayrı; kaldırma onay ister (F1126). */
  async function setPublished(next: boolean) {
    if (publishBusy) return;
    if (
      !next &&
      !(await confirm({
        title: t("property.unpublishConfirm.title", { title: p.title }),
        body: t("property.unpublishConfirm.body"),
        confirmLabel: t("property.unpublishConfirm.confirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setPublishBusy(true);
    setPublishStatus({});
    try {
      await apiFetch(`/api/properties/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: next }),
      });
      setPublishStatus({ message: t(next ? "property.publishedNow" : "property.unpublishedNow") });
      onChanged();
    } catch (err) {
      setPublishStatus({ error: errorText(err) });
    } finally {
      setPublishBusy(false);
    }
  }

  // Aramada görünürlük = yayında + belge doğrulanmış (src/lib/compliance/listing.ts).
  const visibilityKey = !p.isActive
    ? "off"
    : p.licenseStatus === "VERIFIED"
      ? "live"
      : p.licenseStatus === "REJECTED"
        ? "rejected"
        : "pending";

  return (
    <Card title={p.title} id={pid}>
      <p className="text-sm text-gray-700">
        {t("property.basePrice", { price: f.money(p.basePriceMinor, p.currency) })} ·{" "}
        {p.ratingAvg > 0
          ? t("property.rating", {
              rating: f.number(p.ratingAvg, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
            })
          : t("property.noRating")}{" "}
        · {t("property.license")}{" "}
        {/* P1-10: kayıt doğrulaması yapılmamış ilan yayına alınamaz ve aramada görünmez. */}
        <span data-testid="license-status">{t(`licenseStatus.${p.licenseStatus}`)}</span>
      </p>
      {/* Yayın durumu kartın üstünde; kaldırma ayrı düğme + onayla (F1126/F1127). */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        {!p.isActive && (
          <span className="inline-flex items-center rounded-full border border-gray-500 px-2 py-0.5 text-xs font-semibold text-gray-900">
            {t("property.unpublished")}
          </span>
        )}
        <p className="text-sm font-medium text-gray-900">
          {t(`property.visibility.${visibilityKey}`)}
        </p>
        <Button
          variant="secondary"
          className="min-h-[44px] sm:min-h-0"
          busy={publishBusy}
          onClick={() => void setPublished(!p.isActive)}
        >
          {p.isActive ? t("property.unpublish") : t("property.publish")}
          <span className="sr-only">: {p.title}</span>
        </Button>
        <Status error={publishStatus.error} message={publishStatus.message} />
      </div>
      <details open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary className={`inline-flex min-h-[44px] cursor-pointer items-center ${linkClass}`}>
          {t("property.manage")}
          <span className="sr-only">: {p.title}</span>
        </summary>
        {/* Kapalı kartın formları ve istekleri (depozito, fotoğraf) yalnız açılınca oluşturulur. */}
        {open && (
          <div className="mt-2">
            <form onSubmit={save} className="grid gap-4 md:grid-cols-2" aria-busy={busy}>
              <Field
                label={t("property.fields.title")}
                id={`${pid}-name`}
                hint={t("property.fields.titleHint")}
                error={errors.title}
              >
                <input
                  id={`${pid}-name`}
                  className={inputClass}
                  value={form.title}
                  minLength={2}
                  maxLength={120}
                  required
                  onChange={(e) => edit({ title: e.target.value })}
                />
              </Field>
              <div>
                <Field
                  label={t("property.fields.basePrice", { currency: p.currency })}
                  id={`${pid}-price`}
                  hint={t("property.fields.basePriceHint")}
                  error={errors.basePrice}
                >
                  <input
                    id={`${pid}-price`}
                    type="text"
                    inputMode="decimal"
                    className={inputClass}
                    value={form.basePrice}
                    required
                    onChange={(e) => edit({ basePrice: e.target.value })}
                  />
                </Field>
                <p aria-live="polite" className="mt-1 text-xs text-gray-700">
                  {priceMinor !== null &&
                    priceMinor > 0 &&
                    priceMinor !== p.basePriceMinor &&
                    t("property.pricePreview", {
                      price: f.money(priceMinor, p.currency),
                      previous: f.money(p.basePriceMinor, p.currency),
                    })}
                </p>
              </div>
              <div className="md:col-span-2">
                <Field
                  label={t("property.fields.description")}
                  id={`${pid}-desc`}
                  hint={t("create.descriptionHint")}
                  error={errors.description}
                >
                  <textarea
                    id={`${pid}-desc`}
                    rows={4}
                    className={inputClass}
                    value={form.description}
                    minLength={10}
                    maxLength={DESCRIPTION_MAX}
                    required
                    onChange={(e) => edit({ description: e.target.value })}
                  />
                </Field>
                <DescriptionCount length={form.description.length} />
              </div>
              <div>
                <Field
                  label={t("property.fields.licenseNumberOptional")}
                  id={`${pid}-license`}
                  hint={t("property.fields.licenseHint")}
                  error={errors.licenseNumber}
                >
                  <input
                    id={`${pid}-license`}
                    className={inputClass}
                    value={form.licenseNumber}
                    pattern="(0[1-9]|[1-7]\d|8[01])-\d{3,6}(-\d{4})?"
                    onChange={(e) => edit({ licenseNumber: e.target.value })}
                  />
                </Field>
                <p aria-live="polite" className="mt-1 text-xs text-gray-700">
                  {licenseChanged && t("property.licenseChangeNote")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <Button type="submit" busy={busy}>
                  {busy ? t("property.saving") : t("property.save")}
                  <span className="sr-only">: {p.title}</span>
                </Button>
                <p aria-live="polite" className="text-sm font-medium text-gray-900">
                  {dirty && !busy && t("unsaved.indicator")}
                </p>
                <Status error={status.error} message={status.message} />
              </div>
            </form>

            <div className="mt-6 border-t pt-4">
              <h3 className="text-base font-semibold text-gray-900">{t("rooms.title")}</h3>
              <RoomList propertyId={p.id} rooms={p.rooms} onChanged={onChanged} />
              <AddRoomForm
                propertyId={p.id}
                currency={p.currency}
                basePriceMinor={p.basePriceMinor}
                onAdded={onChanged}
              />
            </div>

            {p.rooms.length > 0 ? (
              <CalendarForm rooms={p.rooms} propertyId={p.id} currency={p.currency} />
            ) : (
              // Takvim oda bazındadır: odasız mülkte bölüm gizlenmez, nedeni açıklanır (F840).
              <div className="mt-6 border-t pt-4">
                <h3 className="text-base font-semibold text-gray-900">{t("calendar.title")}</h3>
                <p className="mt-2 text-sm text-gray-700">{t("calendar.noRooms")}</p>
              </div>
            )}
            <PhotoUpload propertyId={p.id} onChanged={onChanged} />
            <ListingCopy propertyId={p.id} onApply={applyDraft} />
            <DepositSettings propertyId={p.id} />
          </div>
        )}
      </details>
      {confirmDialog}
    </Card>
  );
}

/** Odalar: satışa kapatma/açma (PATCH /api/properties/[id]/rooms). */
function RoomList({
  propertyId,
  rooms,
  onChanged,
}: {
  propertyId: string;
  rooms: HostRoom[];
  onChanged: () => void;
}) {
  const t = useTranslations("host");
  const errorText = useErrorText();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});

  async function toggle(room: HostRoom) {
    if (pendingId) return;
    setPendingId(room.id);
    setStatus({});
    try {
      await apiFetch(`/api/properties/${propertyId}/rooms`, {
        method: "PATCH",
        body: JSON.stringify({ roomId: room.id, available: !room.available }),
      });
      setStatus({ message: t("rooms.updated") });
      onChanged();
    } catch (err) {
      setStatus({ error: errorText(err) });
    } finally {
      setPendingId(null);
    }
  }

  if (rooms.length === 0) {
    return <p className="mt-2 text-sm text-gray-700">{t("rooms.empty")}</p>;
  }

  return (
    <>
      <ul className="mt-2 space-y-1 text-sm text-gray-800">
        {rooms.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3">
            <span>
              {r.name} · {t("rooms.capacity", { count: r.maxOccupancy })} ·{" "}
              {t("rooms.units", { count: r.units })} {r.available ? "" : t("rooms.closed")}
            </span>
            <Button
              variant="secondary"
              className="min-h-[44px] sm:min-h-0"
              busy={pendingId === r.id}
              aria-disabled={pendingId !== null}
              onClick={() => void toggle(r)}
            >
              {r.available ? t("rooms.closeSale") : t("rooms.openSale")}
              <span className="sr-only">: {r.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Status error={status.error} message={status.message} />
    </>
  );
}

function AddRoomForm({
  propertyId,
  currency,
  basePriceMinor,
  onAdded,
}: {
  propertyId: string;
  currency: string;
  /** Verilirse oda fiyatı önizlemesi (taban + ek ücret) gösterilir (F841). */
  basePriceMinor?: number;
  onAdded: () => void;
}) {
  const t = useTranslations("host");
  const tc = useTranslations("common");
  const f = useFormat();
  const errorText = useErrorText();
  const id = `room-${propertyId}`;
  const [form, setForm] = useState(() => ({
    name: "",
    capacity: "2",
    bedType: DEFAULT_BED_TYPE as string,
  }));
  const [priceModifier, setPriceModifier] = useState("0");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);

  // Oda adı girilip eklenmediyse sayfadan ayrılırken uyarılır (F838).
  useHostUnsavedChanges(form.name.trim() !== "");
  const modifierPreview = priceModifier.trim() === "" ? 0 : parseMinor(priceModifier, currency);

  /** Düzenleme önceki "Oda eklendi." mesajını kaldırır. */
  function edit(patch: Partial<typeof form>) {
    setForm((cur) => ({ ...cur, ...patch }));
    if (status.message) setStatus({});
  }

  const order: ReadonlyArray<[string, string]> = [
    ["name", `${id}-name`],
    ["capacity", `${id}-cap`],
    ["bedType", `${id}-bed`],
    ["priceModifier", `${id}-mod`],
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    const modifierMinor = priceModifier.trim() === "" ? 0 : parseMinor(priceModifier, currency);
    if (modifierMinor === null || modifierMinor < 0) {
      const next = { priceModifier: t("property.invalidAmount") };
      setErrors(next);
      focusFirstInvalid(next, order);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await apiFetch(`/api/properties/${propertyId}/rooms`, {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          capacity: Number(form.capacity),
          bedType: form.bedType,
          priceModifier: minorToMajor(modifierMinor, currency),
        }),
      });
      setStatus({ message: t("rooms.add.added") });
      setForm({ ...form, name: "" });
      onAdded();
    } catch (err) {
      const keys = serverFieldKeys(err);
      if (keys.length > 0) {
        const next = Object.fromEntries(keys.map((k) => [k, t("form.fieldInvalid")]));
        setErrors(next);
        setStatus({ error: t("form.fieldErrorsSummary", { count: keys.length }) });
        focusFirstInvalid(next, order);
      } else {
        setStatus({ error: errorText(err) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 grid gap-3 md:grid-cols-5"
      aria-labelledby={`${id}-label ${propertyHeadingId(propertyId)}`}
      aria-busy={busy}
    >
      {/* Form adı mülk adını da içerir: her mülkteki "Oda ekle" formu ayırt edilir (F527). */}
      <span id={`${id}-label`} hidden>
        {t("rooms.add.ariaLabel")}
      </span>
      <Field label={t("rooms.add.name")} id={`${id}-name`} error={errors.name}>
        <input
          id={`${id}-name`}
          className={inputClass}
          value={form.name}
          required
          maxLength={80}
          onChange={(e) => edit({ name: e.target.value })}
        />
      </Field>
      <Field
        label={t("rooms.add.capacity")}
        id={`${id}-cap`}
        hint={t("rooms.add.capacityHint")}
        error={errors.capacity}
      >
        <input
          id={`${id}-cap`}
          type="number"
          inputMode="numeric"
          min={1}
          max={20}
          className={inputClass}
          value={form.capacity}
          required
          onChange={(e) => edit({ capacity: e.target.value })}
        />
      </Field>
      {/* Sabit kod saklanır; misafire kendi dilinde gösterilir (F1306). */}
      <Field label={t("rooms.add.bedType")} id={`${id}-bed`} error={errors.bedType}>
        <select
          id={`${id}-bed`}
          className={inputClass}
          value={form.bedType}
          required
          onChange={(e) => edit({ bedType: e.target.value })}
        >
          {BED_TYPES.map((type) => (
            <option key={type} value={type}>
              {tc(`bedTypes.${type}`)}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <Field
          label={t("rooms.add.priceModifierOptionalLabel", { currency })}
          id={`${id}-mod`}
          hint={t("rooms.add.priceModifierHint")}
          error={errors.priceModifier}
        >
          <input
            id={`${id}-mod`}
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={priceModifier}
            onChange={(e) => {
              setPriceModifier(e.target.value);
              if (status.message) setStatus({});
            }}
          />
        </Field>
        {/* Birim/anlam belirsizliği için canlı örnek: taban + ek ücret = oda gecelik fiyatı. */}
        <p aria-live="polite" className="mt-1 text-xs text-gray-700">
          {basePriceMinor !== undefined &&
            modifierPreview !== null &&
            modifierPreview >= 0 &&
            t("rooms.add.pricePreview", {
              total: f.money(basePriceMinor + modifierPreview, currency),
              base: f.money(basePriceMinor, currency),
              modifier: f.money(modifierPreview, currency),
            })}
        </p>
      </div>
      <div className="flex items-end">
        <Button
          type="submit"
          variant="secondary"
          className="w-full"
          busy={busy}
          aria-describedby={propertyHeadingId(propertyId)}
        >
          {busy ? t("rooms.add.adding") : t("rooms.add.submit")}
        </Button>
      </div>
      <div className="md:col-span-5">
        <Status error={status.error} message={status.message} />
      </div>
    </form>
  );
}

function CalendarForm({
  rooms,
  propertyId,
  currency,
}: {
  rooms: HostRoom[];
  propertyId: string;
  currency: string;
}) {
  const t = useTranslations("host");
  const f = useFormat();
  const errorText = useErrorText();
  const { confirm, confirmDialog } = useConfirm();
  const id = `cal-${propertyId}`;
  const today = isoDay(0);
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [from, setFrom] = useState(isoDay(1));
  const [to, setTo] = useState(isoDay(7));
  const [price, setPrice] = useState("");
  const [availability, setAvailability] = useState<"keep" | "open" | "close">("keep");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [busy, setBusy] = useState(false);
  /** Son başarıyla uygulanan değerler; aynı değerler "kaydedilmemiş" sayılmaz. */
  const [appliedKey, setAppliedKey] = useState<string | null>(null);

  // Aralık denetimi istemcide (F528): geçmiş başlangıç, ters aralık, 365 geceden uzun aralık.
  const nights = from && to ? nightsInclusive(from, to) : null;
  const fromError = from && from < today ? t("calendar.fromPast") : null;
  const toError =
    nights === null
      ? null
      : nights < 1
        ? t("calendar.toBeforeFrom")
        : nights > MAX_CALENDAR_NIGHTS
          ? t("calendar.tooLong", { max: MAX_CALENDAR_NIGHTS })
          : null;
  const rangeHint =
    nights !== null && !toError ? t("calendar.rangeHint", { count: nights }) : undefined;
  const toMax = from ? addIsoDays(from, MAX_CALENDAR_NIGHTS - 1) : undefined;

  // Uygulanacak değişikliğin canlı özeti (oda, aralık, gece sayısı, fiyat, müsaitlik) (F842/F845).
  const roomName = rooms.find((r) => r.id === roomId)?.name ?? "";
  const previewMinor = price.trim() ? parseMinor(price, currency) : null;
  const changes = [
    previewMinor !== null && previewMinor > 0
      ? t("calendar.summaryPrice", { price: f.money(previewMinor, currency) })
      : null,
    availability === "open" ? t("calendar.summaryOpen") : null,
    availability === "close" ? t("calendar.summaryClose") : null,
  ].filter((x): x is string => x !== null);
  const summary =
    nights !== null && !fromError && !toError && changes.length > 0
      ? t("calendar.summary", {
          room: roomName,
          from: f.date(from, "short"),
          to: f.date(to, "short"),
          count: nights,
          changes: changes.join(", "),
        })
      : null;

  // Girilmiş ama uygulanmamış fiyat/müsaitlik değişikliğinde ayrılma uyarısı (F838).
  const formKey = JSON.stringify([roomId, from, to, price.trim(), availability]);
  const hasPending = price.trim() !== "" || availability !== "keep";
  useHostUnsavedChanges(hasPending && formKey !== appliedKey);

  /** Alan değişince önceki sonuç mesajı kaldırılır (artık ekrandaki değerleri yansıtmaz). */
  function touched() {
    if (status.message) setStatus({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setStatus({});
    setPriceError(null);
    if (fromError || toError) {
      document.getElementById(fromError ? `${id}-from` : `${id}-to`)?.focus();
      return;
    }
    const body: Record<string, unknown> = { from, to };
    if (price.trim()) {
      const minor = parseMinor(price, currency);
      if (minor === null || minor <= 0) {
        setPriceError(t("property.invalidAmount"));
        document.getElementById(`${id}-price`)?.focus();
        return;
      }
      body.price = minorToMajor(minor, currency);
    }
    if (availability !== "keep") body.isAvailable = availability === "open";
    if (body.price === undefined && body.isAvailable === undefined) {
      setPriceError(t("calendar.noChange"));
      document.getElementById(`${id}-price`)?.focus();
      return;
    }
    // Satışa kapatma geniş etkili: oda, aralık ve gece sayısı onaylatılır.
    if (
      availability === "close" &&
      !(await confirm({
        title: t("calendar.closeConfirm.title"),
        body: [
          t("calendar.closeConfirm.body", {
            room: roomName,
            from: f.date(from, "short"),
            to: f.date(to, "short"),
            count: nights ?? 0,
          }),
          typeof body.price === "number" && previewMinor !== null
            ? t("calendar.closeConfirmPrice", { price: f.money(previewMinor, currency) })
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: t("calendar.closeConfirm.confirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    // Uzun aralıkta toplu fiyat/müsaitlik değişikliği özetle onaylatılır (F845).
    if (
      availability !== "close" &&
      (nights ?? 0) > BULK_CONFIRM_NIGHTS &&
      !(await confirm({
        title: t("calendar.bulkConfirm.title"),
        body: summary ?? undefined,
        confirmLabel: t("calendar.bulkConfirm.confirm"),
        tone: "primary",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ updated: number; created: number; skippedLocked: number }>(
        `/api/rooms/${roomId}/availability`,
        { method: "PUT", body: JSON.stringify(body) }
      );
      setStatus({
        message: t("calendar.result", {
          updated: res.updated,
          created: res.created,
          skipped: res.skippedLocked,
        }),
      });
      setAppliedKey(formKey);
    } catch (err) {
      setStatus({ error: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        onSubmit={submit}
        className="mt-6 border-t pt-4"
        aria-labelledby={`${id}-title ${propertyHeadingId(propertyId)}`}
        aria-busy={busy}
      >
        <h3 id={`${id}-title`} className="text-base font-semibold text-gray-900">
          {t("calendar.title")}
        </h3>
        <div className="mt-2 grid gap-3 md:grid-cols-5">
          <Field label={t("calendar.room")} id={`${id}-room`}>
            <select
              id={`${id}-room`}
              className={inputClass}
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                touched();
              }}
            >
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("calendar.from")} id={`${id}-from`} error={fromError}>
            <input
              id={`${id}-from`}
              type="date"
              className={inputClass}
              value={from}
              min={today}
              required
              onChange={(e) => {
                setFrom(e.target.value);
                touched();
              }}
            />
          </Field>
          <Field label={t("calendar.to")} id={`${id}-to`} error={toError}>
            <input
              id={`${id}-to`}
              type="date"
              className={inputClass}
              value={to}
              min={from || today}
              max={toMax}
              required
              onChange={(e) => {
                setTo(e.target.value);
                touched();
              }}
            />
          </Field>
          <Field
            label={t("calendar.priceLabel", { currency })}
            id={`${id}-price`}
            hint={t("calendar.priceHint")}
            error={priceError}
          >
            <input
              id={`${id}-price`}
              type="text"
              inputMode="decimal"
              className={inputClass}
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                touched();
              }}
            />
          </Field>
          <Field label={t("calendar.availability")} id={`${id}-avail`}>
            <select
              id={`${id}-avail`}
              className={inputClass}
              value={availability}
              onChange={(e) => {
                setAvailability(e.target.value as typeof availability);
                touched();
              }}
            >
              <option value="keep">{t("calendar.keep")}</option>
              <option value="open">{t("calendar.open")}</option>
              <option value="close">{t("calendar.close")}</option>
            </select>
          </Field>
        </div>
        {/* Seçili gece sayısı ve uygulanacak değişiklik canlı duyurulur (F843/F842). */}
        <p id={`${id}-summary`} aria-live="polite" className="mt-3 text-sm text-gray-800">
          {summary ?? rangeHint}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="secondary"
            busy={busy}
            aria-describedby={`${id}-summary ${propertyHeadingId(propertyId)}`}
          >
            {t("calendar.submit")}
          </Button>
          <Status error={status.error} message={status.message} />
        </div>
      </form>
      {confirmDialog}
    </>
  );
}

function ListingCopy({
  propertyId,
  onApply,
}: {
  propertyId: string;
  /** Taslağı mülk formunun açıklama alanına aktarır (kaydetmez) (F846/F847). */
  onApply?: (text: string) => void;
}) {
  const t = useTranslations("host");
  const errorText = useErrorText();
  const [draft, setDraft] = useState<{ tr: string; en: string } | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error?: string; message?: string }>({});

  function apply(lang: "tr" | "en") {
    if (!draft || !onApply) return;
    onApply(draft[lang]);
    setNotice({ message: t("listingCopy.applied") });
  }

  async function copy(lang: "tr" | "en") {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft[lang]);
      setNotice({ message: t("listingCopy.copied") });
    } catch {
      setNotice({ error: t("listingCopy.copyFailed") });
    }
  }

  async function suggest() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice({});
    try {
      const res = await apiFetch<{ draft: { tr: string; en: string }; llmMode: string }>(
        "/api/ai/listing-copy",
        { method: "POST", body: JSON.stringify({ propertyId }) }
      );
      setDraft(res.draft);
      setMode(res.llmMode);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="mb-2 text-base font-semibold text-gray-900">{t("listingCopy.title")}</h3>
      <Button
        variant="secondary"
        onClick={suggest}
        busy={busy}
        aria-describedby={propertyHeadingId(propertyId)}
      >
        {/* Taslak varken yeniden üretimin onu değiştireceği etikette söylenir (F1308). */}
        {busy
          ? t("listingCopy.suggesting")
          : draft
            ? t("listingCopy.regenerate")
            : t("listingCopy.suggest")}
      </Button>
      <div aria-live="polite" className="mt-3 space-y-2">
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {draft && (
          <div className="space-y-2 rounded-md bg-gray-50 p-3 text-sm text-gray-900">
            <p className="flex items-center gap-2 font-medium">
              {t("listingCopy.draft")} <LlmBadge mode={mode} />
            </p>
            {(["tr", "en"] as const).map((lang) => (
              <div key={lang} className="space-y-2">
                <p>
                  <span className="font-semibold">
                    {t(lang === "tr" ? "listingCopy.trLabel" : "listingCopy.enLabel")}
                  </span>{" "}
                  <span lang={lang}>{draft[lang]}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {onApply && (
                    <Button variant="secondary" onClick={() => apply(lang)}>
                      {t("listingCopy.apply", { lang })}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => void copy(lang)}>
                    {t("listingCopy.copy", { lang })}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Status error={notice.error} message={notice.message} />
    </div>
  );
}

interface PhotoUploadResult {
  photo: { id: string; url: string; quality: { qualityScore: number } };
  duplicate: { scope: "SAME_PROPERTY" | "OWN_LISTING" | "OTHER_LISTING"; distance: number } | null;
  warnings: Array<"DUPLICATE" | "LOW_QUALITY">;
  visual: { enabled: boolean; reason: string | null };
}

interface HostPhoto {
  id: string;
  url: string;
  qualityScore: number | null;
}

/** P1-10: fotoğraf yükleme — kalite skoru, duplikat ve düşük kalite uyarısı (engellemez). */
function PhotoUpload({ propertyId, onChanged }: { propertyId: string; onChanged: () => void }) {
  const t = useTranslations("host");
  const { confirm, confirmDialog } = useConfirm();
  const errorText = useErrorText();
  const [results, setResults] = useState<Array<{ name: string; result: PhotoUploadResult }>>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const inputId = `photo-${propertyId}`;
  const headingId = `${inputId}-heading`;
  const photosLoader = useLoader(
    () =>
      apiFetch<{ photos: HostPhoto[]; limits?: { maxBytes: number; maxPhotos: number } }>(
        `/api/host/properties/${propertyId}/photos`
      ),
    [propertyId]
  );
  const photos = photosLoader.data?.photos ?? null;
  // Kısıtlar yüklemeden önce söylenir (F445); `limits` yoksa sunucu varsayılanı.
  const limits = photosLoader.data?.limits;
  const maxBytes = limits?.maxBytes ?? DEFAULT_PHOTO_MAX_BYTES;
  const sizeMb = Math.round(maxBytes / (1024 * 1024));
  const limitReached = !!limits && photos !== null && photos.length >= limits.maxPhotos;
  const uploadHint = [
    t("photos.uploadHint", { size: sizeMb }),
    t("photos.multipleHint"),
    limits && photos !== null
      ? limitReached
        ? t("photos.limitReached")
        : t("photos.limitHint", { count: photos.length, max: limits.maxPhotos })
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  /** Seçilen dosyalar sırayla yüklenir; ilerleme ve dosya bazında sonuç duyurulur (F1310). */
  async function uploadAll(selected: File[]) {
    if (busy || selected.length === 0) return;
    setErrors([]);
    setMessage(null);
    setResults([]);
    const failed: string[] = [];
    const done: Array<{ name: string; result: PhotoUploadResult }> = [];
    // Sınırı aşan dosyalar hiç gönderilmez; tek bir hata satırıyla bildirilir.
    const room = limits && photos !== null ? Math.max(0, limits.maxPhotos - photos.length) : null;
    const files = room === null ? selected : selected.slice(0, room);
    if (limits && files.length < selected.length) {
      failed.push(
        t("photos.tooMany", { count: selected.length - files.length, max: limits.maxPhotos })
      );
      setErrors([...failed]);
    }
    if (files.length === 0) return;
    setBusy(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({ current: i + 1, total: files.length });
        // Biçim ve boyut istemcide denetlenir; hata dosya adını ve sınırı söyler.
        if (file.type && !PHOTO_TYPES.includes(file.type)) {
          failed.push(t("photos.badType", { name: file.name }));
        } else if (file.size > maxBytes) {
          failed.push(t("photos.tooLarge", { name: file.name, size: sizeMb }));
        } else {
          try {
            const body = new FormData();
            body.append("file", file);
            const result = await apiFetch<PhotoUploadResult>(
              `/api/host/properties/${propertyId}/photos`,
              { method: "POST", body }
            );
            done.push({ name: file.name, result });
          } catch (err) {
            failed.push(t("photos.uploadFailed", { name: file.name, reason: errorText(err) }));
          }
        }
        setErrors([...failed]);
        setResults([...done]);
      }
      if (done.length > 0) {
        setMessage(
          files.length === 1
            ? t("photos.uploaded", { name: done[0].name })
            : t("photos.uploadedMany", { count: done.length, total: files.length })
        );
        photosLoader.reload();
        onChanged();
      }
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    if (busy) return;
    if (
      !(await confirm({
        title: t("photos.removeConfirm.title"),
        body: t("photos.removeConfirm.body"),
        confirmLabel: t("photos.removeConfirm.confirm"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    setErrors([]);
    setMessage(null);
    try {
      await apiFetch(`/api/host/properties/${propertyId}/photos/${photoId}`, { method: "DELETE" });
      setResults((cur) => cur.filter((r) => r.result.photo.id !== photoId));
      setMessage(t("photos.removed"));
      photosLoader.reload();
      onChanged();
    } catch (err) {
      setErrors([errorText(err)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-6 border-t pt-4"
      aria-labelledby={`${headingId} ${propertyHeadingId(propertyId)}`}
    >
      <h3 id={headingId} className="text-base font-semibold text-gray-900">
        {t("photos.title")}
      </h3>
      {photosLoader.error ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Status error={photosLoader.error} />
          <Button variant="secondary" busy={photosLoader.loading} onClick={photosLoader.reload}>
            {t("dashboard.retry")}
          </Button>
        </div>
      ) : photos === null ? (
        <p role="status" className="mt-2 text-sm text-gray-600">
          {t("photos.loading")}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-gray-700">
            {t("photos.count", { count: photos.length })}
          </p>
          {photos.length > 0 && (
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((photo, i) => {
                const score =
                  photo.qualityScore === null ? null : Math.round(photo.qualityScore * 100);
                return (
                  <li key={photo.id} className="space-y-1 text-xs text-gray-700">
                    {/* eslint-disable-next-line @next/next/no-img-element -- host önizlemesi, optimize edilmez */}
                    <img
                      src={photo.url}
                      alt={t("photos.alt", { index: i + 1 })}
                      className="aspect-[4/3] w-full rounded-md object-cover"
                      loading="lazy"
                    />
                    {score !== null && (
                      <p>{t("photos.qualityRated", { score, level: qualityLevel(score) })}</p>
                    )}
                    <Button
                      variant="secondary"
                      className="min-h-[44px] w-full sm:min-h-0"
                      aria-disabled={busy}
                      onClick={() => void remove(photo.id)}
                    >
                      {t("photos.remove")}
                      <span className="sr-only">: {t("photos.alt", { index: i + 1 })}</span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <div className="mt-3">
        <Field label={t("photos.uploadLabel")} id={inputId} hint={uploadHint}>
          <input
            id={inputId}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            multiple
            disabled={limitReached}
            aria-disabled={busy || undefined}
            className={`mt-1 block min-h-[44px] text-sm text-gray-800 aria-disabled:opacity-60 ${focusRing}`}
            onClick={(e) => {
              // Yüklemede seçici açılmaz; `disabled` olmadığından odak kaybolmaz (F1128).
              if (busy) e.preventDefault();
            }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void uploadAll(files);
            }}
          />
        </Field>
      </div>
      <div aria-live="polite" className="mt-2 space-y-1 text-sm">
        {busy && (
          <p className="text-gray-700">
            {progress && progress.total > 1
              ? t("photos.uploadingProgress", { current: progress.current, total: progress.total })
              : t("photos.uploading")}
          </p>
        )}
        {errors.length > 0 && (
          <div role="alert" className="space-y-1 text-red-700">
            {errors.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </div>
        )}
        {message && <p className="text-green-800">{message}</p>}
        {results.map(({ name, result }) => {
          const score = Math.round(result.photo.quality.qualityScore * 100);
          return (
            <div key={result.photo.id} className="space-y-1">
              <p className="text-gray-800">
                {results.length > 1 && <span className="font-medium">{name}: </span>}
                {t("photos.qualityRated", { score, level: qualityLevel(score) })}
              </p>
              {result.duplicate && (
                <p role="alert" className="text-amber-800">
                  {t(`photos.duplicate.${result.duplicate.scope}`)}{" "}
                  <button
                    type="button"
                    className={`inline-flex min-h-[44px] items-center py-1 font-medium underline sm:min-h-0 ${focusRing}`}
                    onClick={() => void remove(result.photo.id)}
                  >
                    {t("photos.remove")}
                    {results.length > 1 && <span className="sr-only">: {name}</span>}
                  </button>
                </p>
              )}
              {result.warnings.includes("LOW_QUALITY") && (
                <p className="text-amber-800">{t("photos.lowQuality")}</p>
              )}
            </div>
          );
        })}
        {results.some(({ result }) => !result.visual.enabled) && (
          <p className="text-gray-600">{t("photos.visualOff")}</p>
        )}
      </div>
      {confirmDialog}
    </section>
  );
}
