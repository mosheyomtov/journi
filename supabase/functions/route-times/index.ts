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
    const roadKm: number     = summary.distance / 1000;
    const drivingMin         = drivingSecs / 60;
    const driving            = fmt(drivingMin);

    // ── Extract road geometry (vertexes = [lng,lat,lng,lat,...]) ──
    const drivingPath: {lat: number; lng: number}[] = [];
    const sections: any[] = kakaoData?.routes?.[0]?.sections ?? [];
    for (const section of sections) {
      for (const road of section.roads ?? []) {
        const v: number[] = road.vertexes ?? [];
        for (let i = 0; i < v.length - 1; i += 2) {
          drivingPath.push({ lng: v[i], lat: v[i + 1] });
        }
      }
    }

    // ── 2. ODsay → real transit time + pointDistance for walking ──
    let transit: string;
    let walking: string;
    let walkingMin: number;
    let transitMin: number | null = null;

    try {
      const odsayUrl =
        `https://api.odsay.com/v1/api/searchPubTransPathT` +
        `?SX=${origin.lng}&SY=${origin.lat}` +
        `&EX=${destination.lng}&EY=${destination.lat}` +
        `&apiKey=${encodeURIComponent(ODSAY_KEY)}`;

      const odsayRes  = await fetch(odsayUrl, { headers: { Referer: REFERER } });
      const odsayData = await odsayRes.json();
      const result    = odsayData?.result;

      // Walking: pointDistance (straight-line meters) × 1.25 city-block factor ÷ 4.5 km/h
      const straightM: number = result?.pointDistance ?? (roadKm * 1000 * 0.75);
      walkingMin = (straightM * 1.25) / 4500 * 60;
      walking    = fmt(walkingMin);

      // Transit: prefer subway (pathType=1), else best by totalTime
      // pathType: 1=subway only, 2=bus only, 3=mixed
      const paths: any[]  = result?.path ?? [];
      const subwayPath    = paths.find((p: any) => p.pathType === 1);
      const bestPath      = subwayPath ?? paths[0];
      const rawMin: number | undefined = bestPath?.info?.totalTime;

      if (rawMin != null && typeof rawMin === "number") {
        // Bus-only routes: multiply by 1.5 for realistic wait time
        const adjusted = bestPath.pathType === 2 ? rawMin * 1.5 : rawMin;
        transitMin = Math.round(adjusted);
        transit    = fmt(adjusted);
      } else {
        transit = "אין קו ישיר";
        console.warn("ODsay no path:", JSON.stringify(odsayData).slice(0, 200));
      }
    } catch (e) {
      console.error("ODsay error:", e);
      walkingMin = roadKm * 0.75 / 4.5 * 60;
      walking    = fmt(walkingMin) + "*";
      const fb   = roadKm < 2  ? roadKm / 15 * 60 + 5
                 : roadKm < 10 ? roadKm / 30 * 60 + 8
                 :               roadKm / 40 * 60 + 10;
      transitMin = Math.round(fb);
      transit    = fmt(fb) + "*";
    }

    return new Response(JSON.stringify({
      walking, transit, driving, drivingPath,
      minutes: {
        walking:  Math.round(walkingMin),
        transit:  transitMin,
        driving:  Math.round(drivingMin),
      }
    }), {
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
