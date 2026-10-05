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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
