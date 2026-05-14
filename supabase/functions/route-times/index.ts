import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const KAKAO_KEY = Deno.env.get("KAKAO_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmt(min: number): string {
  if (min < 1) return "< 1 דק'";
  if (min < 60) return `${Math.round(min)} דק'`;
  return `${Math.floor(min / 60)}ש' ${String(Math.round(min % 60)).padStart(2, "0")}דק'`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { origin, destination } = await req.json();

    // ── Kakao Mobility: car route (duration + actual road distance) ──
    const kakaoRes = await fetch(
      `https://apis-navi.kakaomobility.com/v1/directions` +
        `?origin=${origin.lng},${origin.lat}` +
        `&destination=${destination.lng},${destination.lat}` +
        `&priority=RECOMMEND`,
      { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const summary = kakaoData?.routes?.[0]?.summary;

    if (!summary) {
      // Kakao returned no route (e.g. water, restricted area) — return error
      throw new Error(`Kakao no route: ${JSON.stringify(kakaoData)}`);
    }

    // duration in seconds, distance in meters
    const drivingSecs: number = summary.duration;
    const roadMeters: number = summary.distance;   // actual road distance
    const roadKm = roadMeters / 1000;

    // ── Driving ──
    const driving = fmt(drivingSecs / 60);

    // ── Walking: road distance / 4 km/h (real path, not straight line) ──
    const walking = fmt(roadKm / 4 * 60);

    // ── Transit: Seoul subway model
    //   < 2 km  → likely walking or 1-2 stops → 4–10 min overhead + slow (15 km/h)
    //   2-10 km → subway + walk to/from station (avg 30 km/h + 8 min overhead)
    //   > 10 km → express subway (avg 40 km/h + 10 min overhead)
    let transitMin: number;
    if (roadKm < 2) {
      transitMin = roadKm / 15 * 60 + 5;
    } else if (roadKm < 10) {
      transitMin = roadKm / 30 * 60 + 8;
    } else {
      transitMin = roadKm / 40 * 60 + 10;
    }
    const transit = fmt(transitMin);

    return new Response(JSON.stringify({ walking, transit, driving }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("route-times error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
