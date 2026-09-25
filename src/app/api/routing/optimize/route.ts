import { cityKey } from "@/lib/routing/city-key";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { optimizeRoute, type CityNode } from "@/lib/routing/optimizer";
import { getConfig } from "@/lib/config/app-config";
import { toErrorResponse, ValidationError } from "@/lib/http/errors";
import { monthOf, todayUtc } from "@/lib/time/nights";

const norm = cityKey;

/**
 * Çok şehirli rota optimizasyonu. Hata #12 düzeltmeleri: şehir adları büyük/küçük
 * harf ve Türkçe karakter duyarsız eşleşir, liste tekilleştirilir ve
 * ROUTING_MAX_CITIES ile sınırlanır (DoS yok), ay 1–12.
 */
export async function GET(req: NextRequest) {
  try {
    const max = getConfig().ROUTING_MAX_CITIES;
    const schema = z.object({
      origin: z.string().trim().min(1).max(80),
      cities: z
        .string()
        .max(1000)
        .transform((v) =>
          v
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean)
        )
        .pipe(z.array(z.string().max(80)).min(1).max(max)),
      month: z.coerce.number().int().min(1).max(12).optional(),
      returnToOrigin: z.enum(["true", "false"]).optional(),
    });
    const q = schema.parse(Object.fromEntries(req.nextUrl.searchParams));

    const names = [q.origin, ...q.cities];
    const unique = [...new Map(names.map((n) => [norm(n), n])).values()];
    if (unique.length !== names.length) throw new ValidationError("Şehir listesi tekrar içeremez");

    // Eşleştirme uygulamada `norm` ile (veritabanının `insensitive` karşılaştırması Türkçe
    // İ/ı'yı katlamaz); lokasyon tablosu küçüktür.
    const wanted = new Set(unique.map(norm));
    const locations = (
      await prisma.location.findMany({ select: { city: true, latitude: true, longitude: true } })
    ).filter((l) => wanted.has(norm(l.city)));
    const byKey = new Map(locations.map((l) => [norm(l.city), l]));
    const nodes: CityNode[] = [];
    for (const name of unique) {
      const hit = byKey.get(norm(name));
      if (hit?.latitude == null || hit.longitude == null) {
        return NextResponse.json({ error: `Koordinat bulunamadı: ${name}` }, { status: 422 });
      }
      nodes.push({ id: hit.city, name: hit.city, lat: hit.latitude, lng: hit.longitude });
    }
    const month = q.month ?? monthOf(todayUtc());
    const plan = optimizeRoute(nodes.slice(1), nodes[0], month, {
      returnToOrigin: q.returnToOrigin === "true",
    });
    return NextResponse.json({
      origin: nodes[0].name,
      cities: nodes.slice(1).map((n) => n.name),
      month,
      plan,
    });
  } catch (error) {
    return toErrorResponse(error, "routing.optimize");
  }
}

export const dynamic = "force-dynamic";
