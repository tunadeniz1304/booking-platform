/**
 * Inside Airbnb içe aktarımı için saf yardımcılar (P2-2) — ağ/DB yok, birim testli.
 *
 * Veri: Inside Airbnb (https://insideairbnb.com), lisans CC BY 4.0 — atıf zorunlu
 * (README "Veri atfı"). OSM POI'ları: © OpenStreetMap katkıda bulunanlar, ODbL.
 *
 * Hem özet (`visualisations/listings.csv`) hem ayrıntılı (`listings.csv.gz`) dosya
 * biçimini okur; yalnız ihtiyaç duyulan sütunlar eşlenir. Kişisel veri (ev sahibi adı,
 * host_id) içe alınmaz.
 */

export const INSIDE_AIRBNB_ATTRIBUTION =
  "Kaynak: Inside Airbnb (insideairbnb.com), CC BY 4.0 lisansıyla uyarlanmıştır.";
export const OSM_ATTRIBUTION = "© OpenStreetMap katkıda bulunanlar (ODbL)";

/** RFC 4180 CSV: tırnaklı alan, alan içi virgül/satır sonu ve "" kaçışı; BOM ve CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      if (ch === "\r" && src[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** Başlık satırına göre kayıt nesneleri (başlık adları küçük harfe, boşluksuz). */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return rows.map((cells) => {
    const rec: Record<string, string> = {};
    keys.forEach((k, idx) => {
      rec[k] = (cells[idx] ?? "").trim();
    });
    return rec;
  });
}

/**
 * "$1,234.50" / "1234" / "₺950.00" → minor-unit (2 basamak). Geçersiz, sıfır veya üst
 * sınırı aşan fiyat → null (ilan atlanır). Float aritmetiği yok.
 */
export function parsePriceMinor(raw: string, maxMajor = 1_000_000): bigint | null {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/,/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const major = BigInt(m[1]!);
  const cents = BigInt((m[2] ?? "").padEnd(2, "0"));
  const minor = major * 100n + cents;
  if (minor <= 0n || major > BigInt(maxMajor)) return null;
  return minor;
}

export type ImportedPropertyType = "HOTEL" | "APARTMENT" | "VILLA" | "HOSTEL" | "BED_AND_BREAKFAST";

/** Inside Airbnb `room_type` (+ ayrıntılı dosyada `property_type`) → platform türü. */
export function mapPropertyType(roomType: string, propertyType = ""): ImportedPropertyType {
  const pt = propertyType.toLowerCase();
  if (pt.includes("villa")) return "VILLA";
  if (pt.includes("hostel")) return "HOSTEL";
  if (pt.includes("bed and breakfast") || pt.includes("b&b")) return "BED_AND_BREAKFAST";
  if (pt.includes("hotel")) return "HOTEL";
  switch (roomType.toLowerCase()) {
    case "hotel room":
      return "HOTEL";
    case "shared room":
      return "HOSTEL";
    case "private room":
      return "BED_AND_BREAKFAST";
    default:
      return "APARTMENT";
  }
}

export interface MappedListing {
  externalId: string;
  title: string;
  description: string;
  propertyType: ImportedPropertyType;
  neighbourhood: string | null;
  latitude: number | null;
  longitude: number | null;
  nightlyMinor: bigint;
  maxOccupancy: number;
  minimumNights: number;
  licenseNumber: string | null;
  imageUrl: string | null;
}

export type MapResult = { ok: true; listing: MappedListing } | { ok: false; reason: string };

function intIn(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

function coord(raw: string | undefined, limit: number): number | null {
  const n = Number(raw);
  return raw && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

/** HTML etiketlerini ve fazla boşluğu atar (ayrıntılı dosyadaki açıklamalar HTML içerir). */
function plain(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** İçe aktarılan ilanın açıklamasındaki kalıcı işaret (tekrar çalıştırma idempotent). */
export const externalMarker = (externalId: string) => `[insideairbnb:${externalId}]`;

/** Tek bir CSV kaydını platform ilanına eşler; zorunlu alan eksikse gerekçeyle atlar. */
export function mapListing(rec: Record<string, string>): MapResult {
  const externalId = rec.id ?? "";
  if (!/^\d{1,24}$/.test(externalId)) return { ok: false, reason: "id geçersiz" };
  const nightlyMinor = parsePriceMinor(rec.price ?? "");
  if (nightlyMinor === null) return { ok: false, reason: "fiyat yok/geçersiz" };
  const neighbourhood =
    plain(rec.neighbourhood_cleansed || rec.neighbourhood || rec.neighbourhood_group || "") || null;
  const name = plain(rec.name ?? "");
  const title = clip(name || `İstanbul konaklaması #${externalId}`, 120);
  const summary = plain(rec.description ?? "");
  const roomType = rec.room_type ?? "";
  const description = [
    summary
      ? clip(summary, 1200)
      : `${neighbourhood ?? "İstanbul"} bölgesinde ${roomType || "konaklama"}.`,
    ...(neighbourhood ? [`Semt: ${neighbourhood}.`] : []),
    INSIDE_AIRBNB_ATTRIBUTION,
    externalMarker(externalId),
  ].join("\n\n");
  const license = plain(rec.license ?? "");
  const picture = rec.picture_url ?? "";
  return {
    ok: true,
    listing: {
      externalId,
      title,
      description,
      propertyType: mapPropertyType(roomType, rec.property_type ?? ""),
      neighbourhood,
      latitude: coord(rec.latitude, 90),
      longitude: coord(rec.longitude, 180),
      nightlyMinor,
      maxOccupancy: intIn(rec.accommodates, 1, 16, roomType === "Entire home/apt" ? 4 : 2),
      minimumNights: intIn(rec.minimum_nights, 1, 30, 1),
      licenseNumber: license ? clip(license, 64) : null,
      imageUrl: /^https:\/\/[^\s]+$/.test(picture) ? picture : null,
    },
  };
}

// ---------------------------------------------------------------------------
// OSM POI (Overpass) — opsiyonel zenginleştirme
// ---------------------------------------------------------------------------

export interface Poi {
  name: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** İlan koordinatlarını kapsayan kutu (+ pay); koordinat yoksa null. */
export function bboxOf(points: Array<{ lat: number; lon: number }>, padDeg = 0.01): BBox | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  return {
    south: Math.min(...lats) - padDeg,
    west: Math.min(...lons) - padDeg,
    north: Math.max(...lats) + padDeg,
    east: Math.max(...lons) + padDeg,
  };
}

/** Turistik yerler, müzeler ve anıtlar (adı olanlar); sonuç sayısı sınırlı. */
export function overpassQuery(b: BBox, limit = 300): string {
  const box = [b.south, b.west, b.north, b.east].map((n) => n.toFixed(5)).join(",");
  return (
    `[out:json][timeout:25];(` +
    `node["tourism"~"^(attraction|museum|viewpoint)$"]["name"](${box});` +
    `node["historic"~"^(monument|castle|memorial)$"]["name"](${box});` +
    `);out ${limit};`
  );
}

/** Overpass JSON yanıtını doğrulayarak POI listesine çevirir (bozuk öğeler atlanır). */
export function parseOverpass(json: unknown): Poi[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const out: Poi[] = [];
  for (const el of elements) {
    const e = el as { lat?: unknown; lon?: unknown; tags?: Record<string, unknown> };
    const name = typeof e.tags?.["name:tr"] === "string" ? e.tags["name:tr"] : e.tags?.name;
    if (typeof e.lat !== "number" || typeof e.lon !== "number" || typeof name !== "string") {
      continue;
    }
    const kind = String(e.tags?.tourism ?? e.tags?.historic ?? "poi");
    out.push({ name: clip(plain(name), 80), kind, lat: e.lat, lon: e.lon });
  }
  return out;
}

/** Büyük daire mesafesi (metre). */
export function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Yarıçap içindeki en yakın `max` POI (mesafeye, sonra ada göre deterministik). */
export function nearestPois(
  at: { lat: number; lon: number },
  pois: readonly Poi[],
  max = 3,
  radiusM = 1500
): Array<Poi & { distanceM: number }> {
  return pois
    .map((p) => ({ ...p, distanceM: Math.round(haversineMeters(at, p)) }))
    .filter((p) => p.distanceM <= radiusM)
    .sort((x, y) => x.distanceM - y.distanceM || x.name.localeCompare(y.name))
    .slice(0, max);
}

/** Açıklamaya eklenecek "Yakındaki yerler" satırı (+ ODbL atfı); POI yoksa null. */
export function poiSentence(near: ReadonlyArray<Poi & { distanceM: number }>): string | null {
  if (near.length === 0) return null;
  const list = near.map((p) => `${p.name} (${p.distanceM} m)`).join(", ");
  return `Yakındaki yerler: ${list}. ${OSM_ATTRIBUTION}.`;
}
