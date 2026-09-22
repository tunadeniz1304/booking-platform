import { NextRequest, NextResponse } from "next/server";
import { searchProperties } from "@/lib/search";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "12");

    const params = {
      query: searchParams.get("destination") ?? searchParams.get("query") ?? undefined,
      city: undefined as string | undefined,
      country: undefined as string | undefined,
      checkIn: searchParams.get("checkIn") ?? undefined,
      checkOut: searchParams.get("checkOut") ?? undefined,
      guests: searchParams.get("guests") ? Number(searchParams.get("guests")) : undefined,
      minPrice: searchParams.get("minPrice") ? Number(searchParams.get("minPrice")) : undefined,
      maxPrice: searchParams.get("maxPrice") ? Number(searchParams.get("maxPrice")) : undefined,
      propertyType: searchParams.get("propertyType") ?? undefined,
      amenities: searchParams.get("amenities")?.split(",").filter(Boolean),
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 50) : 12,
      sort: (searchParams.get("sort") ?? "recommended") as
        | "price_asc"
        | "price_desc"
        | "rating"
        | "recommended",
    };

    const response = await searchProperties(params);
    return NextResponse.json(response);
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const dynamic = "force-dynamic";
