// Run: node tests/algorithm.test.js
const fs = require("fs");
const path = require("path");

global.window = global;
window.YTCAL_FEATURES = {
  thresholds: {
    commentWeight: 1,
    minViewsForScore: 100,
    lowQualityMaxViews: 100,
    lowQualityMinAgeHours: 6,
    lowQualityMinVph: 100,
    lowQualityOldHours: 48,
    lowQualityMaxViewsOld: 1000,
    lowQualityMaxEngagement: 0.002,
    priorViews: 30,
    priorHours: 3,
    durationWeight: 0.25,
    durationNeutralMin: 8,
  },
};
window.ytInitialData = null;

eval(fs.readFileSync(path.join(__dirname, "..", "content", "core.js"), "utf8"));

const c = window.YTCAL.core;
const T = window.YTCAL_FEATURES.thresholds;

let pass = 0;
let fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) pass++;
  else {
    fail++;
    console.error(`FAIL ${msg}: got ${actual}, want ${expected}`);
  }
}
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL ${msg}`);
  }
}

// --- localized number parsing (input from YouTube UI, PL + EN) ---
eq(c.parseLocalizedNumber("71 tys."), 71000, "71 tys.");
eq(c.parseLocalizedNumber("2,42 tys."), 2420, "2,42 tys.");
eq(c.parseLocalizedNumber("27 597"), 27597, "27 597");
eq(c.parseLocalizedNumber("1.2M"), 1200000, "1.2M");
eq(c.parseLocalizedNumber("3,4 mln"), 3400000, "3,4 mln");
eq(c.parseLocalizedNumber("84 tysiące wyświetleń"), 84000, "84 tysiące wyświetleń");
eq(c.parseLocalizedNumber("71 tysięcy wyświetleń"), 71000, "71 tysięcy wyświetleń");
eq(c.parseLocalizedNumber("2 miliony wyświetleń"), 2000000, "2 miliony");
eq(c.parseLocalizedNumber("1 234 komentarzy"), 1234, "1 234 komentarzy (no false scale)");
eq(c.parseLocalizedNumber("101 tysięcy wyświetleń"), 101000, "101 tysięcy");
eq(c.parseAgeHours("11 miesięcy temu"), 7920, "11 miesięcy");

// --- metadata row classification (never treat a channel name as views) ---
ok(c.isViewsLabel("49 tysięcy wyświetleń"), "views label PL");
ok(c.isViewsLabel("1.2M views"), "views label EN");
ok(!c.isViewsLabel("Daniel Dalen"), "channel name is not a views label");
ok(!c.isViewsLabel("Zweryfikowano"), "verified badge is not a views label");
ok(c.isAgeLabel("1 dzień temu"), "age label PL");
ok(!c.isAgeLabel("Daniel Dalen"), "channel name is not an age label");
eq(c.parseLocalizedNumber(""), null, "empty -> null");

// A long digit run (e.g. a garbage page value) must not overflow into a huge float.
const junkViews =
  "1 234 567 890 123 456 800 " + Array(42).fill("000").join(" ") + " wyświetleń";
eq(c.parseLocalizedNumber("123456789012345678901234567890"), null, "absurd count -> null");
eq(c.extractViews(junkViews), null, "absurd views text -> null");
eq(c.analyze({ views: 1.2345678901234568e144, ageHours: 1 }), null, "absurd views -> no analysis");

// --- metadata row: views fallback when the aria lacks a views keyword ---
eq(
  c.rowViewsText(["Daniel Dalen", "Zweryfikowano", "17", "1 dzień temu"]),
  "17",
  "views = numeric label before the age"
);
eq(
  c.rowViewsText(["Szewczyk Travel", "101 tysięcy wyświetleń", "11 miesięcy temu"]),
  "101 tysięcy wyświetleń",
  "views = explicit views keyword"
);
eq(c.rowViewsText(["Some Channel", "1 dzień temu"]), null, "no views label -> null");

// --- age parsing ---
eq(c.parseAgeHours("7 godz. temu"), 7, "7 godz.");
eq(c.parseAgeHours("1 dzień temu"), 24, "1 dzień");
eq(c.parseAgeHours("2 tyg. temu"), 336, "2 tyg.");
eq(c.parseAgeHours("3 mies. temu"), 2160, "3 mies.");
eq(c.parseAgeHours("45 min temu"), 0.75, "45 min");
ok(c.parseAgeHours("przed chwilą") < 0.02, "just now ~0");

// --- watch page: view extraction and absolute date parsing ---
eq(c.extractViews("105 tys. wyświetleń  1 dzień temu"), 105000, "extractViews info row");
eq(c.extractViews("105 456 wyświetleń • Data premiery: 3 paź 2026"), 105456, "extractViews tooltip exact");
eq(c.extractViews("1.2M views"), 1200000, "extractViews EN");
eq(c.extractViews("1 dzień temu"), null, "extractViews: no views -> null");
eq(c.parseMonthDate("1 dzień temu"), null, "relative date -> null");
const d = c.parseMonthDate("3 paź 2026");
ok(
  d instanceof Date && d.getUTCFullYear() === 2026 && d.getUTCMonth() === 9 && d.getUTCDate() === 3,
  "parseMonthDate PL"
);

// --- duration parsing / length adjustment ---
eq(c.parseDurationSec("1:00:24"), 3624, "duration clock H:MM:SS");
eq(c.parseDurationSec("6:03"), 363, "duration clock M:SS");
eq(c.parseDurationSec("1 godzina i 24 sekundy"), 3624, "duration aria PL hours");
eq(c.parseDurationSec("28 minut i 16 sekund"), 1696, "duration aria PL minutes");
eq(c.formatDurationSec(3624), "1:00:24", "format duration");
const shortVid = c.analyze({ views: 10000, ageHours: 12, durationSec: 60 });
const longVid = c.analyze({ views: 10000, ageHours: 12, durationSec: 3600 });
ok(longVid.score > shortVid.score, `longer video scores higher (${longVid.score.toFixed(1)} > ${shortVid.score.toFixed(1)})`);

// --- Wilson lower bound ---
ok(c.wilsonLowerBound(0, 18) === 0, "0/18 -> 0");
ok(c.wilsonLowerBound(1, 1) < c.wilsonLowerBound(60, 100), "1/1 < 60/100 (small sample)");

// --- low-quality rule ---
ok(!c.isLowQuality({ views: 84000, ageHours: 24, lb: null }, T), "84000/1d NOT low (regression)");
ok(c.isLowQuality({ views: 18, ageHours: 21, lb: null }, T), "18/21h low");
ok(c.isLowQuality({ views: 466, ageHours: 11, lb: null }, T), "466/11h low (velocity floor)");
ok(c.isLowQuality({ views: 1000, ageHours: 24, lb: null }, T), "1000/1d low (42 vph)");
ok(!c.isLowQuality({ views: 3000, ageHours: 24, lb: null }, T), "3000/1d NOT low (125 vph)");
ok(c.isLowQuality({ views: 120, ageHours: 720, lb: null }, T), "120/30d low (total reach)");
ok(!c.isLowQuality({ views: 5000, ageHours: 72, lb: null }, T), "5000/3d NOT low");
ok(!c.isLowQuality({ views: 18, ageHours: 2, lb: null }, T), "18/2h fresh -> NOT low");
ok(c.isLowQuality({ views: 100000, ageHours: 720, lb: 0.0005 }, T), "many views + near-zero ER -> low");

// --- analyze / verdict: the contradiction cases ---

// A: user's sample — high engagement must yield Strong, and engagement label "high"
const A = c.analyze({ views: 9500, likes: 347, comments: 69, ageHours: 120 });
eq(A.verdict, "Strong", "A verdict Strong");
eq(A.labels.engagement, "above average", "A engagement label above average");
ok(Math.abs(A.confidence - 1) < 1e-9, "A confidence 1.0");

// B: same video on a tile (no likes) — reach only (velocity faded for old videos).
const B = c.analyze({ views: 9500, ageHours: 120 });
eq(B.verdict, "Good", "B raster: reach-only -> Good");
ok(Math.abs(B.confidence - 0.65) < 1e-9, "B confidence 0.65 (reach+velocity, engagement unknown)");
eq(B.labels.engagement, "unknown", "B engagement unknown");

// G: old popular video (101k views / 11 months) must not be penalized by lifetime VPH.
const G = c.analyze({ views: 101000, ageHours: 7920 });
ok(G.verdict === "Strong" || G.verdict === "Top", `G old popular not penalized (${G.verdict} ${G.score.toFixed(1)})`);
eq(G.metrics.recent, false, "G old -> velocity not weighted");
eq(G.labels.velocity, "not weighted (old)", "G velocity label");

// C: missing engagement is neutral, not a different weight vector.
// Compare watch with engagement at the baseline against the no-engagement tile.
const Cw = c.analyze({ views: 10000, likes: 230, comments: 27, ageHours: 12 }); // (L+C)/V ~ median ER
const Ct = c.analyze({ views: 10000, ageHours: 12 });
ok(Math.abs(Cw.score - Ct.score) < 3, `C tile/watch agree at typical engagement (${Cw.score.toFixed(1)} vs ${Ct.score.toFixed(1)})`);
eq(Cw.verdict, Ct.verdict, "C verdict agrees");
eq(c.scoreFromZ(0, 0, 0), 50, "score at baseline z=0 is 50");

// D: boosted — must be Suspicious, never "Strong + boosted"
const D = c.analyze({ views: 100000, likes: 280, comments: 20, ageHours: 3 });
eq(D.verdict, "Suspicious", "D verdict Suspicious");
ok(D.verdict !== "Strong", "D never Strong");

// E / F: blur and badge share one decision; "Low" verdict => blur
eq(c.analyze({ views: 466, ageHours: 11 }).verdict, "Low", "E verdict Low");
eq(c.analyze({ views: 120, ageHours: 720 }).verdict, "Low", "F verdict Low");

// Monotonicity: a component labeled "high" must raise the aggregate.
const hiEng = c.analyze({ views: 9500, likes: 347, comments: 69, ageHours: 120 });
const loEng = c.analyze({ views: 9500, likes: 5, comments: 0, ageHours: 120 });
ok(hiEng.score > loEng.score, `engagement raises score (${hiEng.score.toFixed(1)} > ${loEng.score.toFixed(1)})`);
const hiReach = c.analyze({ views: 500000, ageHours: 24 });
const loReach = c.analyze({ views: 5000, ageHours: 24 });
ok(hiReach.score > loReach.score, `reach raises score (${hiReach.score.toFixed(1)} > ${loReach.score.toFixed(1)})`);

// --- 7-step bands (fixed score cuts; no feed dependence) ---
eq(c.bandForScore(10), "Low", "band 10 -> Low");
eq(c.bandForScore(30), "Weak", "band 30 -> Weak");
eq(c.bandForScore(45), "Average", "band 45 -> Average");
eq(c.bandForScore(55), "Good", "band 55 -> Good");
eq(c.bandForScore(68), "Strong", "band 68 -> Strong");
eq(c.bandForScore(80), "Excellent", "band 80 -> Excellent");
eq(c.bandForScore(95), "Top", "band 95 -> Top");

// --- guidance targets are ordered (above-average < high) ---
const tg = c.targets();
ok(tg.viewsAbove < tg.viewsHigh, "targets views above < high");
ok(tg.vphAbove < tg.vphHigh, "targets vph above < high");
ok(tg.erAbove < tg.erHigh, "targets er above < high");

// --- determinism: analyze is pure and feed-independent ---
const a1 = c.analyze({ views: 1100000, ageHours: 7 * 30 * 24 });
const a2 = c.analyze({ views: 1100000, ageHours: 7 * 30 * 24 });
eq(a1.verdict, "Excellent", "1.1M/7mo -> Excellent (not Weak)");
eq(a1.score, a2.score, "same input -> same score (deterministic)");

// --- monetization estimate (watch-time anchored; always a range) ---
const R = c.estimateRevenue({ views: 25262, durationSec: 6018, country: "PL" });
ok(!!R, "estimateRevenue returns a result");
ok(R.low < R.revenue && R.revenue < R.high, "estimate is a range around the central value");
ok(Math.abs(R.revenue - Math.sqrt(R.low * R.high)) < 1e-6, "central = geometric mean of the range");
ok(R.avdLowSec < R.avdHighSec, "watch time is a range (casual < engaged)");
ok(R.watchHoursHigh > R.watchHoursLow && R.watchHoursLow > 0, "watch hours span the range");
ok(R.rpmLow <= R.rpm && R.rpm <= R.rpmHigh, "central RPM sits inside the scenario range");
ok(R.adsPerView <= R.adsPerViewHigh, "ad slots per view are ordered");

const R2 = c.estimateRevenue({ views: 25262, durationSec: 6018, country: "PL" });
eq(R.revenue, R2.revenue, "estimateRevenue deterministic");

// 8-minute mid-roll eligibility cliff (mid-rolls only exist for videos >= 8 min)
const under8 = c.estimateRevenue({ views: 100000, durationSec: 479, avgViewDurationSec: 479 });
const at8 = c.estimateRevenue({ views: 100000, durationSec: 480, avgViewDurationSec: 480 });
eq(under8.adsPerView, 1, "<8 min: pre-roll only (adsPerView 1)");
eq(at8.adsPerView, 2, ">=8 min with 8 min AVD: one mid-roll");
ok(at8.rpm > under8.rpm, "mid-roll raises RPM");

// monotonic in watch time (same views, longer duration/AVD)
const shortV = c.estimateRevenue({ views: 100000, durationSec: 900, avgViewDurationSec: 600 });
const longV = c.estimateRevenue({ views: 100000, durationSec: 3600, avgViewDurationSec: 2400 });
ok(longV.rpm > shortV.rpm, `longer watch time -> higher RPM (${longV.rpm.toFixed(2)} > ${shortV.rpm.toFixed(2)})`);

// measured AVD is more confident than estimated
const meas = c.estimateRevenue({ views: 100000, durationSec: 1200, avgViewDurationSec: 600 });
const est = c.estimateRevenue({ views: 100000, durationSec: 1200 });
eq(meas.avdSource, "measured", "measured AVD tagged");
eq(est.avdSource, "estimated", "estimated AVD tagged");
ok(meas.confidence > est.confidence, "measured AVD -> higher confidence");

// niche scales the rate
const music = c.estimateRevenue({ views: 100000, durationSec: 1200, avgViewDurationSec: 600, category: "Music" });
const news = c.estimateRevenue({ views: 100000, durationSec: 1200, avgViewDurationSec: 600, category: "News & Politics" });
ok(music.rpm < news.rpm, "Music RPM < News RPM");

// category tables cover the full YouTube set and stay in sync
const NICHES = Object.keys(c.REVENUE_DEFAULTS.nicheFactor).filter(
  (k) => k !== "default" && k !== "Finance" && k !== "Business"
);
const RETS = Object.keys(c.REVENUE_DEFAULTS.retentionByNiche).filter((k) => k !== "default");
ok(NICHES.every((k) => RETS.includes(k)), "every CPM category has a retention entry");
const YT_CATEGORIES = [
  "Film & Animation", "Autos & Vehicles", "Music", "Pets & Animals", "Sports",
  "Short Movies", "Travel & Events", "Gaming", "Videoblogging", "People & Blogs",
  "Comedy", "Entertainment", "News & Politics", "Howto & Style", "Education",
  "Science & Technology", "Nonprofits & Activism",
];
ok(YT_CATEGORIES.every((k) => NICHES.includes(k)), "all 17 YouTube categories have a CPM factor");
ok(YT_CATEGORIES.every((k) => RETS.includes(k)), "all 17 YouTube categories have a retention factor");

// category canonicalization (Polish alias -> canonical English)
eq(c.canonicalCategory("Muzyka"), "Music", "PL alias Muzyka -> Music");
eq(c.canonicalCategory("Wiadomości i polityka"), "News & Politics", "PL alias news");
eq(c.canonicalCategory("Music"), "Music", "canonical passthrough");
eq(c.canonicalCategory("Nieznana"), "Nieznana", "unknown category passthrough");
eq(c.canonicalCategory(null), null, "null category -> null");

// unknown country falls back to the default CPM
const zz = c.estimateRevenue({ views: 100000, durationSec: 1200, country: "ZZ" });
const pl = c.estimateRevenue({ views: 100000, durationSec: 1200, country: "PL" });
eq(zz.cpmPln, pl.cpmPln, "unknown country -> _default CPM");

// calibration knobs: rpmScale multiplies the prior, rpmOverride pins RPM
const baseRpm = c.estimateRevenue({ views: 100000, durationSec: 6000 });
eq(baseRpm.rpmSource, "prior", "default rpmSource = prior");
window.YTCAL_FEATURES.revenue = { rpmScale: 1.5 };
const scaled = c.estimateRevenue({ views: 100000, durationSec: 6000 });
ok(Math.abs(scaled.rpm - baseRpm.rpm * 1.5) < 1e-6, "rpmScale multiplies RPM");
eq(scaled.rpmSource, "scaled", "rpmSource = scaled");
window.YTCAL_FEATURES.revenue = { rpmOverride: 35 };
const pinned = c.estimateRevenue({ views: 100000, durationSec: 6000 });
eq(pinned.rpm, 35, "rpmOverride pins RPM");
eq(pinned.rpmSource, "override", "rpmSource = override");
delete window.YTCAL_FEATURES.revenue;

// invalid inputs -> null
eq(c.estimateRevenue({ views: 0 }), null, "0 views -> null");
eq(c.estimateRevenue({ views: -5 }), null, "negative views -> null");
eq(c.estimateRevenue({ views: 1.2345678901234568e144 }), null, "absurd views -> null");
eq(c.estimateRevenue({}), null, "missing views -> null");

// retention decays with length: a long video is not watched ~half through
const long100 = c.estimateRevenue({ views: 70000, durationSec: 6000 }); // 100 min
ok(long100.avdSec < 0.35 * 6000, `long-video AVD well under half (${Math.round(long100.avdSec / 60)} min)`);
ok(
  long100.watchHours < 35000,
  `70k views on a 100-min video -> < 35k watch hours (${Math.round(long100.watchHours)})`
);
const short5 = c.estimateRevenue({ views: 100000, durationSec: 300 });
const mid20 = c.estimateRevenue({ views: 100000, durationSec: 1200 });
ok(short5.avdSec / 300 > mid20.avdSec / 1200, "retention % declines with length");
ok(short5.avdSec >= 20 && mid20.avdSec >= 20, "AVD respects the absolute floor");
ok(c.estimateRevenue({ views: 100000, durationSec: 6000 }).avdSec <= 6000, "AVD never exceeds duration");

// Screenshot fixture: ~3M-view long news video, AVD ~37 min. The Studio rows in that
// range report ~82k-118k PLN, so the estimate must land in the same order of magnitude.
const fixture = c.estimateRevenue({
  views: 3000000, durationSec: 3600, avgViewDurationSec: 37 * 60,
  category: "News & Politics", country: "PL",
});
ok(
  fixture.revenue >= 60000 && fixture.revenue <= 130000,
  `fixture revenue plausible (${Math.round(fixture.revenue)} PLN, want 60k-130k)`
);
ok(fixture.rpm >= 25 && fixture.rpm <= 45, `fixture RPM plausible (${fixture.rpm.toFixed(1)}, want 25-45)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
