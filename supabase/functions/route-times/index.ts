import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const KAKAO_KEY  = Deno.env.get("KAKAO_API_KEY")!;
const ODSAY_KEY  = Deno.env.get("ODSAY_API_KEY")!;
const REFERER    = "https://mosheyomtov.github.io";

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

    // ── 1. Kakao Mobility → driving time + real road distance ──
    const kakaoRes = await fetch(
      `https://apis-navi.kakaomobility.com/v1/directions` +
        `?origin=${origin.lng},${origin.lat}` +
        `&destination=${destination.lng},${destination.lat}` +
        `&priority=RECOMMEND`,
      { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } }
    );
    const kakaoData = await kakaoRes.json();
    const summary = kakaoData?.routes?.[0]?.summary;
    if (!summary) throw new Error(`Kakao no route: ${JSON.stringify(kakaoData)}`);

    const drivingSecs: number = summary.duration;
    const roadKm: number = summary.distance / 1000;

    const driving = fmt(drivingSecs / 60);
    const walking = fmt(roadKm / 4 * 60); // road distance ÷ 4 km/h

    // ── 2. ODsay → real transit time ──
    let transit: string;
    try {
      const odsayUrl =
        `https://api.odsay.com/v1/api/searchPubTransPathT` +
        `?SX=${origin.lng}&SY=${origin.lat}` +
        `&EX=${destination.lng}&EY=${destination.lat}` +
        `&apiKey=${encodeURIComponent(ODSAY_KEY)}`;

      const odsayRes = await fetch(odsayUrl, {
        headers: { Referer: REFERER },
      });
      const odsayData = await odsayRes.json();

      // ODsay returns paths sorted by totalTime (minutes)
      const totalMin: number | undefined =
        odsayData?.result?.path?.[0]?.info?.totalTime;

      if (totalMin != null && typeof totalMin === "number") {
        transit = fmt(totalMin);
      } else {
        // No transit route found (e.g. too close, or no service)
        transit = "אין קו ישיר";
        console.warn("ODsay no path:", JSON.stringify(odsayData));
      }
    } catch (e) {
      console.error("ODsay error:", e);
      // Fallback to distance-based estimate
      const fallbackMin = roadKm < 2 ? roadKm / 15 * 60 + 5
        : roadKm < 10 ? roadKm / 30 * 60 + 8
        : roadKm / 40 * 60 + 10;
      transit = fmt(fallbackMin) + "*";
    }

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
