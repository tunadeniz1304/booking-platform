import { prisma } from "@/lib/prisma";

/**
 * Elasticsearch adaptörü (opsiyonel) — indexing + fuzzy + geo search.
 *
 * Ortam değişkeni `ELASTICSEARCH_URL` ayarlıysa etkindir; ayarsızsa tüm
 * fonksiyonlar `null`/`false` döner ve sistem PostgreSQL (pgvector + pg_trgm)
 * üzerinden degrade (fallback) çalışır. Böylece ES olmadan da uygulama
 * tam işlevseldir; ES varlığında semantik/fuzzy arama oradan gider.
 *
 * Bağımlılıksız: ağır `@elastic/elasticsearch` istemcisi yerine HTTP arayüzü
 * (REST) kullanılır.
 */
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || "";

export const elasticEnabled = ELASTICSEARCH_URL.length > 0;

const INDEX = "booking-properties";

interface EsHit {
  _score: number;
  _source: { id: string };
}

async function esFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!elasticEnabled) {
    throw new Error("ELASTICSEARCH_URL ayarlı değil — adaptör kapalı");
  }
  return fetch(`${ELASTICSEARCH_URL}/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

/** Bir mülkü dizine yazar (upsert). */
export async function indexProperty(propertyId: string): Promise<boolean> {
  if (!elasticEnabled) return false;
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: { location: true, amenities: { select: { name: true } } },
  });
  if (!property) return false;

  const doc = {
    id: property.id,
    title: property.title,
    description: property.description,
    propertyType: property.propertyType,
    basePrice: Number(property.basePrice),
    ratingAvg: property.ratingAvg,
    city: property.location.city,
    country: property.location.country,
    amenities: property.amenities.map((a) => a.name),
    location:
      property.location.latitude && property.location.longitude
        ? { lat: property.location.latitude, lon: property.location.longitude }
        : null,
  };

  const res = await esFetch(`_index/${INDEX}/_doc/${property.id}`, {
    method: "PUT",
    body: JSON.stringify(doc),
  });
  return res.ok;
}

export interface EsSearchHit {
  id: string;
  score: number;
}

/** Fuzzy (fuzziness=AUTO) + skor sıralamalı metin araması. */
export async function esFuzzySearch(query: string, size = 30): Promise<EsSearchHit[] | null> {
  if (!elasticEnabled) return null;
  const body = {
    query: {
      bool: {
        should: [
          {
            multi_match: {
              query,
              fields: ["title^3", "description", "city^2", "country"],
              fuzziness: "AUTO",
            },
          },
        ],
      },
    },
    size,
  };

  const res = await esFetch(`${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { hits?: { hits?: EsHit[] } };
  return (json.hits?.hits ?? [])
    .map((h) => ({ id: h._source.id, score: h._score ?? 0 }))
    .filter((h) => h.id);
}

/** Konum + yarıçap (km) coğrafi araması. */
export async function esGeoSearch(
  lat: number,
  lon: number,
  distanceKm: number,
  size = 30
): Promise<EsSearchHit[] | null> {
  if (!elasticEnabled) return null;
  const body = {
    query: {
      bool: {
        filter: [
          {
            geo_distance: {
              distance: `${distanceKm}km`,
              location: { lat, lon },
            },
          },
        ],
      },
    },
    size,
  };

  const res = await esFetch(`${INDEX}/_search`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { hits?: { hits?: EsHit[] } };
  return (json.hits?.hits ?? [])
    .map((h) => ({ id: h._source.id, score: h._score ?? 0 }))
    .filter((h) => h.id);
}
