import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const KAKAO_KEY = Deno.env.get("KAKAO_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Haversine distance (km) ──
function haversineKm(o: { lat: number; lng: number }, d: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((d.lat - o.lat) * Math.PI) / 180;
  const dLng = ((d.lng - o.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((o.lat * Math.PI) / 180) *
      Math.cos((d.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmt(min: number): string {
  if (min < 1) return "< 1 דק'";
  if (min < 60) return `${Math.round(min)} דק'`;
  return `${Math.floor(min / 60)}ש' ${Math.round(min % 60)}דק'`;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { origin, destination } = await req.json();

    const dist = haversineKm(origin, destination);

    // ── Walking: haversine-based (no public API for pedestrian in Korea) ──
    const walking = fmt(dist / 5 * 60);

    // ── Transit: rough estimate ──
    const transit = fmt(dist / 26 * 60 + 6);

    // ── Driving: Kakao Mobility Directions API ──
    // Kakao uses longitude,latitude order
    let driving = fmt(dist / 30 * 60 + 3); // fallback
    try {
      const kakaoRes = await fetch(
        `https://apis-navi.kakaomobility.com/v1/directions` +
          `?origin=${origin.lng},${origin.lat}` +
          `&destination=${destination.lng},${destination.lat}` +
          `&priority=RECOMMEND`,
        {
          headers: { Authorization: `KakaoAK ${KAKAO_KEY}` },
        }
      );
      const kakaoData = await kakaoRes.json();
      const secs = kakaoData?.routes?.[0]?.summary?.duration;
      if (secs && typeof secs === "number") {
        driving = fmt(secs / 60);
      }
    } catch (e) {
      console.error("Kakao directions error:", e);
    }

    return new Response(JSON.stringify({ walking, transit, driving }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
