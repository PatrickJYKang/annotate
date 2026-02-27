import { NextRequest, NextResponse } from "next/server";

const BASE_URL = "https://api.football-data.org/v4";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-auth-token");
  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const path = req.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Build the upstream URL: path already includes query params from the client
  const url = `${BASE_URL}${path}`;

  try {
    const upstream = await fetch(url, {
      headers: { "X-Auth-Token": apiKey },
    });

    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Proxy fetch failed" }, { status: 502 });
  }
}
