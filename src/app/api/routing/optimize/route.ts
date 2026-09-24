import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CityNode, optimizeRoute } from "@/lib/routing/optimizer";

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const origin = sp.get("origin") ?? "";
  const cities = (sp.get("cities") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (!origin || cities.length === 0) {
    return NextResponse.json({ error: "origin ve cities gerekli" }, { status: 400 });
  }
  const names = [origin, ...cities];
  const locations = await prisma.location.findMany({
    where: { city: { in: names, mode: "insensitive" } },
    select: { city: true, latitude: true, longitude: true },
  });
  const byCity = new Map(locations.map((l) => [l.city, l]));
  const nodes: CityNode[] = [];
  for (const name of names) {
    const hit = byCity.get(name);
    if (hit?.latitude == null || hit.longitude == null) {
      return NextResponse.json({ error: `Koordinat bulunamadı: ${name}` }, { status: 422 });
    }
    nodes.push({ id: name, name, lat: hit.latitude, lng: hit.longitude });
  }
  const month = new Date().getMonth();
  const plan = optimizeRoute(nodes.slice(1), nodes[0], month);
  return NextResponse.json({ origin, cities, month, plan });
}

export const dynamic = "force-dynamic";
