import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  INSIDE_AIRBNB_ATTRIBUTION,
  bboxOf,
  csvRecords,
  externalMarker,
  haversineMeters,
  mapListing,
  mapPropertyType,
  nearestPois,
  overpassQuery,
  parseCsv,
  parseOverpass,
  parsePriceMinor,
  poiSentence,
} from "@/lib/import/insideairbnb";

const fixture = readFileSync(
  path.resolve("tests/fixtures/insideairbnb/listings-sample.csv"),
  "utf8"
);

describe("P2-2 Inside Airbnb içe aktarım eşlemesi (ağsız, fixture CSV)", () => {
  it('CSV: tırnak içi virgül, "" kaçışı, alan içi satır sonu, CRLF ve BOM', () => {
    const rows = parseCsv(`﻿a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\n\n`);
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["line1\nline2", "z"],
    ]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(csvRecords("")).toEqual([]);
  });

  it("fiyat: dolar/virgül biçimi minor-unit'e; geçersiz/sıfır/aşırı → null", () => {
    expect(parsePriceMinor("$1,850.00")).toBe(185_000n);
    expect(parsePriceMinor("₺950.5")).toBe(95_050n);
    expect(parsePriceMinor("320")).toBe(32_000n);
    expect(parsePriceMinor("")).toBeNull();
    expect(parsePriceMinor("$0.00")).toBeNull();
    expect(parsePriceMinor("1.234")).toBeNull();
    expect(parsePriceMinor("2000000")).toBeNull();
  });

  it("tür eşlemesi: property_type önceliklidir, yoksa room_type", () => {
    expect(mapPropertyType("Entire home/apt", "Entire villa")).toBe("VILLA");
    expect(mapPropertyType("Shared room", "Room in hostel")).toBe("HOSTEL");
    expect(mapPropertyType("Private room", "Room in bed and breakfast")).toBe("BED_AND_BREAKFAST");
    expect(mapPropertyType("Hotel room")).toBe("HOTEL");
    expect(mapPropertyType("Shared room")).toBe("HOSTEL");
    expect(mapPropertyType("Private room")).toBe("BED_AND_BREAKFAST");
    expect(mapPropertyType("Entire home/apt", "Entire rental unit")).toBe("APARTMENT");
  });

  it("fixture: geçerli kayıtlar eşlenir, fiyatsız ve geçersiz id atlanır; kişisel veri yok", () => {
    const records = csvRecords(fixture);
    expect(records).toHaveLength(5);
    const results = records.map(mapListing);
    expect(results.map((r) => (r.ok ? r.listing.externalId : r.reason))).toEqual([
      "1001",
      "1002",
      "fiyat yok/geçersiz",
      "id geçersiz",
      "1004",
    ]);

    const galata = results[0]!.ok ? results[0]!.listing : null;
    expect(galata).toMatchObject({
      title: "Galata'da manzaralı daire, 2+1",
      propertyType: "APARTMENT",
      neighbourhood: "Beyoglu",
      nightlyMinor: 185_000n,
      maxOccupancy: 4,
      minimumNights: 2,
      licenseNumber: "34-ABC-1234",
      imageUrl: "https://a0.muscache.com/pictures/demo-1001.jpg",
      latitude: 41.0256,
      longitude: 28.9741,
    });
    // HTML atıldı, kaynak atfı ve kalıcı işaret açıklamada.
    expect(galata!.description).toContain('Balkon var ve "deniz" görüyor.');
    expect(galata!.description).not.toContain("<b>");
    expect(galata!.description).toContain(INSIDE_AIRBNB_ATTRIBUTION);
    expect(galata!.description).toContain(externalMarker("1001"));

    const kadikoy = results[1]!.ok ? results[1]!.listing : null;
    expect(kadikoy).toMatchObject({ propertyType: "BED_AND_BREAKFAST", licenseNumber: null });
    // https olmayan görsel alınmaz; çok satırlı açıklama tek satıra iner.
    expect(kadikoy!.imageUrl).toBeNull();
    expect(kadikoy!.description).toContain("Çok satırlı açıklama");

    const hostel = results[4]!.ok ? results[4]!.listing : null;
    expect(hostel).toMatchObject({ propertyType: "HOSTEL", nightlyMinor: 32_000n });
    // Açıklama yoksa semt + oda türünden kısa metin.
    expect(hostel!.description.startsWith("Fatih bölgesinde Shared room.")).toBe(true);
  });

  it("özet biçim (visualisations/listings.csv): ad yoksa yedek başlık, varsayılan kapasite", () => {
    const [rec] = csvRecords(
      "id,name,host_id,host_name,neighbourhood,latitude,longitude,room_type,price,minimum_nights\n" +
        "77,,123,Ayşe,Besiktas,41.04,29.0,Entire home/apt,1200,40\n"
    );
    const r = mapListing(rec!);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.listing.title).toBe("İstanbul konaklaması #77");
    expect(r.listing.maxOccupancy).toBe(4);
    expect(r.listing.minimumNights).toBe(1);
    expect(Object.values(r.listing).map(String).join(" ")).not.toContain("Ayşe");
    const long = mapListing({ id: "5", name: "x".repeat(300), price: "10", latitude: "999" });
    expect(long.ok && long.listing.title.length).toBe(120);
    expect(long.ok && long.listing.latitude).toBeNull();
  });

  it("OSM: sorgu kutusu, yanıt ayrıştırma ve en yakın POI cümlesi (ODbL atfı)", () => {
    expect(bboxOf([])).toBeNull();
    const box = bboxOf([
      { lat: 41.0, lon: 28.9 },
      { lat: 41.05, lon: 29.0 },
    ])!;
    expect(box.south).toBeCloseTo(40.99, 9);
    expect(box.west).toBeCloseTo(28.89, 9);
    expect(box.north).toBeCloseTo(41.06, 9);
    expect(box.east).toBeCloseTo(29.01, 9);
    expect(overpassQuery(box, 50)).toContain("(40.99000,28.89000,41.06000,29.01000)");
    expect(overpassQuery(box, 50)).toContain("out 50;");

    const pois = parseOverpass({
      elements: [
        {
          lat: 41.0256,
          lon: 28.9742,
          tags: { name: "Galata Tower", "name:tr": "Galata Kulesi", tourism: "attraction" },
        },
        { lat: 41.0086, lon: 28.9802, tags: { name: "Ayasofya", tourism: "museum" } },
        { lat: 41.03, lon: 28.98, tags: { name: "Anıt", historic: "monument" } },
        { lat: "x", lon: 1, tags: { name: "bozuk" } },
        { lat: 41, lon: 29, tags: {} },
      ],
    });
    expect(pois.map((p) => p.name)).toEqual(["Galata Kulesi", "Ayasofya", "Anıt"]);
    expect(parseOverpass(null)).toEqual([]);

    const near = nearestPois({ lat: 41.0256, lon: 28.9741 }, pois, 2, 1000);
    expect(near.map((p) => p.name)).toEqual(["Galata Kulesi", "Anıt"]);
    expect(near[0]!.distanceM).toBeLessThan(20);
    expect(haversineMeters({ lat: 41, lon: 29 }, { lat: 41, lon: 29 })).toBe(0);
    const sentence = poiSentence(near)!;
    expect(sentence).toMatch(/^Yakındaki yerler: Galata Kulesi \(\d+ m\), Anıt \(\d+ m\)\./);
    expect(sentence).toContain("OpenStreetMap");
    expect(poiSentence([])).toBeNull();
  });
});
