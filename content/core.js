// core.js — namespace, metadata parsing, DOM extraction, quality analysis, baseline.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const TAG = "[ytcal]";

  const log = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function thresholds() {
    return (window.YTCAL_FEATURES && window.YTCAL_FEATURES.thresholds) || {};
  }

  // ------------------------------------------------------------------ parsing

  function parseFraction(raw) {
    let t = String(raw).replace(/\s/g, "");
    if (t.includes(",") && t.includes(".")) {
      // The last separator is the decimal separator.
      if (t.lastIndexOf(",") > t.lastIndexOf(".")) t = t.replace(/\./g, "").replace(",", ".");
      else t = t.replace(/,/g, "");
    } else if (t.includes(",")) {
      t = t.replace(",", ".");
    }
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : 0;
  }

  // Parses viewer counts from localized YouTube labels.
  // Handles Polish ("71 tys.", "2,42 tys.", "27 597", "84 tysiące") and English ("1.2M").
  function parseLocalizedNumber(text) {
    if (text == null) return null;
    const s = String(text).toLowerCase().replace(/\u00a0/g, " ").trim();
    if (!s) return null;
    const units = [
      [/([\d][\d\s.,]*)\s*(mld|miliard\w*|billion)\b/, 1e9],
      [/([\d][\d\s.,]*)\s*(mln|milion\w*|million|m)\b/, 1e6],
      [/([\d][\d\s.,]*)\s*(tys\w*|k)\b/, 1e3],
    ];
    for (const [re, mult] of units) {
      const m = s.match(re);
      if (m) return Math.round(parseFraction(m[1]) * mult);
    }
    // Never silently under-count: if a scale word is present but unmatched, bail out.
    if (/(tys|mln|milion|mld|miliard)/.test(s)) return null;
    const m = s.match(/([\d][\d\s.,]*)/);
    if (!m) return null;
    return Math.round(parseFraction(m[1]));
  }

  // Parses video age from localized YouTube labels (e.g. "7 godz. temu", "1 day ago").
  function parseAgeHours(text) {
    if (text == null) return null;
    const s = String(text).toLowerCase().replace(/\u00a0/g, " ").trim();
    if (!s) return null;
    if (/przed chwil|just now|moment|second|sekund|sek\./.test(s)) {
      const m = s.match(/(\d+)\s*sek/);
      return m ? +m[1] / 3600 : 0.001;
    }
    let m;
    if ((m = s.match(/(\d+)\s*(minut|min\b|minute)/))) return +m[1] / 60;
    if ((m = s.match(/(\d+)\s*(godz|godzin|hour|hr)/))) return +m[1];
    if ((m = s.match(/(\d+)\s*(dni|dzień|dzien|day)/))) return +m[1] * 24;
    if ((m = s.match(/(\d+)\s*(tyg|tygo|week)/))) return +m[1] * 24 * 7;
    if ((m = s.match(/(\d+)\s*(miesi|mies|month)/))) return +m[1] * 24 * 30;
    if ((m = s.match(/(\d+)\s*(rok|lat|year)/))) return +m[1] * 24 * 365;
    if (/wczoraj|yesterday/.test(s)) return 24;
    return null;
  }

  // Extracts a view count from free text such as "105 tys. wyświetleń" or "1,234,567 views".
  function extractViews(text) {
    if (!text) return null;
    const m = String(text).match(
      /([\d][\d\s.,]*(?:tys[^\s]*|mln|milion[^\s]*|mld|miliard[^\s]*|million|billion|m|k)?)\s*(?:wyświetl|widz|views?)/i
    );
    return m ? parseLocalizedNumber(m[1]) : null;
  }

  const MONTHS = {
    sty: 0, lut: 1, mar: 2, kwi: 3, maj: 4, cze: 5, lip: 6, sie: 7, wrz: 8, "paź": 9, paz: 9, lis: 10, gru: 11,
    jan: 0, feb: 1, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Parses an absolute date such as "3 paź 2026" / "3 Oct 2026" into a Date (UTC).
  function parseMonthDate(text) {
    if (!text) return null;
    const m = String(text).toLowerCase().match(/(\d{1,2})\s+([a-ząćęłńóśźż]{3,})\s+(\d{4})/);
    if (!m) return null;
    const mon = MONTHS[m[2].slice(0, 3)];
    if (mon == null) return null;
    return new Date(Date.UTC(+m[3], mon, +m[1]));
  }

  // ---------------------------------------------------------------------- DOM

  const ITEM_SELECTOR = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-playlist-video-renderer",
    "yt-lockup-view-model",
  ].join(",");

  function findItems() {
    return Array.from(document.querySelectorAll(ITEM_SELECTOR));
  }

  function isOutermost(el) {
    return !el.parentElement || !el.parentElement.closest(ITEM_SELECTOR);
  }

  function getVideoId(el) {
    const a = el.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (a) {
      try {
        const u = new URL(a.getAttribute("href"), location.origin);
        const v = u.searchParams.get("v");
        if (v) return v;
        const m = u.pathname.match(/\/shorts\/([\w-]{6,})/);
        if (m) return m[1];
      } catch (_) {}
    }
    return el.getAttribute("video-id") || null;
  }

  function isShort(el) {
    return (
      !!el.querySelector('a[href*="/shorts/"]') ||
      el.tagName.toLowerCase() === "ytm-shorts-lockup-view-model" ||
      !!el.closest("ytm-shorts-lockup-view-model")
    );
  }

  // A views label must contain a digit AND a view keyword (never a bare channel name).
  function isViewsLabel(text) {
    return !!text && /\d/.test(text) && /(wyświetl|widz|views?)/i.test(text);
  }

  // An age label is relative-time text ("1 dzień temu", "3 days ago").
  function isAgeLabel(text) {
    return !!text && /(temu|ago|yesterday|wczoraj|przed chwil)/i.test(text);
  }

  // Supports both the new view-model markup and the classic ytd-* renderers.
  function extractMetadata(el) {
    let viewsText = null;
    let ageText = null;

    const rows = el.querySelectorAll(
      '[class*="ytContentMetadataViewModelMetadataRow"], [class*="ContentMetadataViewModelMetadataRow"]'
    );
    for (const row of rows) {
      for (const t of row.querySelectorAll('[class*="MetadataText"]')) {
        const aria = t.getAttribute("aria-label") || t.textContent || "";
        if (!viewsText && isViewsLabel(aria)) viewsText = aria;
        else if (!ageText && isAgeLabel(aria)) ageText = aria;
      }
      if (!ageText) {
        const last = row.querySelector('[class*="LastPart"]');
        if (last) ageText = last.getAttribute("aria-label") || last.textContent;
      }
      if (viewsText && ageText) break;
    }

    if (viewsText == null) {
      const line = el.querySelector("#metadata-line");
      const parts = line
        ? Array.from(line.querySelectorAll("span.inline-metadata-item, span"))
            .map((i) => (i.textContent || "").trim())
            .filter(Boolean)
        : [];
      if (parts.length) {
        const vIdx = parts.findIndex((p) => /wyświetl|widz|view|obejrz/i.test(p));
        viewsText = vIdx >= 0 ? parts[vIdx] : parts[0];
        const maybeAge = parts[parts.length - 1];
        if (maybeAge !== viewsText) ageText = maybeAge;
      }
      if (viewsText == null) {
        const vl = el.querySelector("#view-count, .view-count");
        if (vl) viewsText = vl.textContent;
      }
    }

    const views = parseLocalizedNumber(viewsText);
    const ageHours = parseAgeHours(ageText);
    return { views, ageHours, viewsText, ageText };
  }

  // Nearest renderer exposing `.data` (Polymer) — the source of menu/feedback tokens.
  function getRendererData(el) {
    for (const c of el.querySelectorAll("*")) {
      if (c.data && typeof c.data === "object") return c.data;
    }
    let node = el;
    while (node && node !== document.body && node.tagName !== "YTD-APP") {
      if (node.data && typeof node.data === "object") return node.data;
      node = node.parentElement;
    }
    return null;
  }

  function deepFind(obj, predicate) {
    const seen = new Set();
    const stack = [obj];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object" || seen.has(node)) continue;
      seen.add(node);
      if (predicate(node)) return node;
      for (const k in node) stack.push(node[k]);
    }
    return null;
  }

  // ----------------------------------------------------------------- algorithm

  // Wilson score interval lower bound — robust against small samples.
  // Reference: Evan Miller, "How Not To Sort By Average Rating"; reddit _sorts.pyx.
  function wilsonLowerBound(successes, n, z = 1.96) {
    if (!n || n <= 0) return 0;
    const p = clamp(successes / n, 0, 1);
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, (center - margin) / denom);
  }

  // Bayesian-smoothed views-per-hour: (V + m) / (T + T0). The single velocity
  // definition used everywhere (scoring, labels, low-quality rule).
  function smoothedVph(views, ageHours, priorViews, priorHours) {
    const t = thresholds();
    const m = priorViews != null ? priorViews : t.priorViews != null ? t.priorViews : 30;
    const t0 = priorHours != null ? priorHours : t.priorHours != null ? t.priorHours : 3;
    return (views + m) / (Math.max(ageHours, 0) + t0);
  }

  // Pinned reference (deterministic). The running self-calibrating mean/std was removed: it made
  // scores relative to the feed, so a 1.1M-view video could be labelled "Low" in a feed full of
  // millions (and flipped at the n>=30 switch). A fixed reference keeps scores monotonic in magnitude.
  const REFERENCE = {
    views: { mean: 3.3, std: 1.3 }, // log10(views+1)
    vph: { mean: 1.6, std: 0.9 }, // log10(vph+1) ~= 40 views/hour
    er: { mean: 0.025, std: 0.02 }, // wilson lower bound
  };

  function baselineOf(key) {
    return REFERENCE[key];
  }

  // Low-quality rule. Feed/sidebar expose no like counts, so engagement is usually unknown.
  // Fresh videos are never judged by velocity; old videos are judged by total reach,
  // because views/hour naturally decays for evergreen content.
  function isLowQuality(input, t) {
    const views = input && input.views;
    const ageHours = input && input.ageHours;
    const lb = input && input.lb;
    if (views == null) return false;
    t = t || thresholds();
    const minAge = t.lowQualityMinAgeHours != null ? t.lowQualityMinAgeHours : 6;
    const maxViews = t.lowQualityMaxViews != null ? t.lowQualityMaxViews : 100;
    const minVph = t.lowQualityMinVph != null ? t.lowQualityMinVph : 100;
    const oldHours = t.lowQualityOldHours != null ? t.lowQualityOldHours : 48;
    const maxViewsOld = t.lowQualityMaxViewsOld != null ? t.lowQualityMaxViewsOld : 1000;
    const maxEng = t.lowQualityMaxEngagement != null ? t.lowQualityMaxEngagement : 0.002;

    if (views >= 200 && lb != null && lb < maxEng) return true;

    const age = ageHours != null ? ageHours : 0;
    if (age < minAge) return false;

    if (age <= oldHours) {
      const rawVph = views / Math.max(age, 0.5);
      return views < maxViews || rawVph < minVph;
    }
    return views < maxViewsOld;
  }

  // Velocity only informs the score for recent uploads; for older videos views/hour is a lifetime
  // average. Its weight ramps out smoothly between 24h and 72h (no hard cliff). Missing engagement
  // is neutral (zE = 0). Reach + velocity always sum to 0.65.
  const WEIGHTS = { v: 0.3, p: 0.35, e: 0.35 };
  const VELOCITY_FADE_START = 24;
  const VELOCITY_FADE_END = 72;

  const VERDICT_KEY = {
    Low: "low",
    Weak: "weak",
    Suspicious: "suspicious",
    Average: "average",
    Good: "good",
    Strong: "strong",
    Excellent: "excellent",
    Top: "top",
  };

  function componentLabel(z) {
    if (z >= 1) return "high";
    if (z >= 0.25) return "above average";
    if (z <= -1) return "low";
    if (z <= -0.25) return "below average";
    return "typical";
  }

  function scoreFromZ(zV, zP, zE, w) {
    w = w || WEIGHTS;
    const raw = w.v * zV + w.p * zP + w.e * zE;
    return 100 / (1 + Math.exp(-raw));
  }

  // 7 steps on the fixed score scale (deterministic; a 1M-view video is never labelled "Weak").
  function bandForScore(score) {
    if (score < 20) return "Low";
    if (score < 35) return "Weak";
    if (score < 50) return "Average";
    if (score < 66) return "Good";
    if (score < 76) return "Strong";
    if (score < 88) return "Excellent";
    return "Top";
  }

  function verdictOf(score, input, z) {
    if (isLowQuality(input, thresholds())) return "Low";
    if (input.engagementKnown && z.e <= -1 && (z.v >= 1 || z.p >= 1)) return "Suspicious";
    return bandForScore(score);
  }

  // The single source of truth. Pure and deterministic (no baseline side effects).
  function analyze({ views, likes, comments, ageHours }) {
    if (views == null || views <= 0) return null;
    const t = thresholds();
    const commentWeight = t.commentWeight != null ? t.commentWeight : 3;

    const L = Number.isFinite(likes) ? likes : null;
    const C = Number.isFinite(comments) ? comments : null;
    const engagementKnown = L != null || C != null;

    const weighted = (L || 0) + commentWeight * (C || 0);
    const lb = engagementKnown ? wilsonLowerBound(weighted, views) : null;
    const rawRate = engagementKnown ? weighted / views : null;

    const age = ageHours != null ? ageHours : 1;
    const vph = smoothedVph(views, age);

    const sv = REFERENCE.views;
    const sp = REFERENCE.vph;
    const se = REFERENCE.er;

    const zV = clamp((Math.log10(views + 1) - sv.mean) / sv.std, -3, 3);
    const zP = clamp((Math.log10(vph + 1) - sp.mean) / sp.std, -3, 3);
    const zE = engagementKnown ? clamp((lb - se.mean) / se.std, -3, 3) : 0;

    // Velocity weight fades out between 24h and 72h (lifetime average beyond that).
    const ageH = ageHours != null ? ageHours : 0;
    const f = clamp((ageH - VELOCITY_FADE_START) / (VELOCITY_FADE_END - VELOCITY_FADE_START), 0, 1);
    const W = { v: WEIGHTS.v + WEIGHTS.p * f, p: WEIGHTS.p * (1 - f), e: WEIGHTS.e };
    const recent = f < 1;

    const score = scoreFromZ(zV, zP, zE, W);
    const confidence = W.v + W.p + (engagementKnown ? W.e : 0);
    const z = { v: zV, p: zP, e: zE };
    const verdict = verdictOf(score, { views, ageHours, lb, engagementKnown }, z);

    let reason = null;
    if (verdict === "Low") {
      reason = isLowQuality({ views, ageHours, lb }, t)
        ? "below reach / velocity policy"
        : "low aggregate score";
    } else if (verdict === "Suspicious") {
      reason = "high reach with very low engagement";
    }

    return {
      metrics: { views, likes: L, comments: C, ageHours, vph, lb, rawRate, engagementKnown, recent },
      z,
      score,
      confidence,
      verdict,
      reason,
      band: VERDICT_KEY[verdict],
      // per-component qualitative labels share the exact z used by the aggregate
      labels: {
        reach: componentLabel(zV),
        velocity: recent ? componentLabel(zP) : "not weighted (old)",
        engagement: engagementKnown ? componentLabel(zE) : "unknown",
      },
    };
  }

  function formatNumber(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return Number(n).toLocaleString("en-US");
  }
  function formatAgeHours(h) {
    if (h == null || !Number.isFinite(h)) return "—";
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    if (h < 24) return `${Math.round(h)}h`;
    const d = h / 24;
    if (d < 30) return `${Math.round(d)}d`;
    const mo = h / (24 * 30);
    if (mo < 12) return `${Math.round(mo)}mo`;
    return `${Math.round(h / (24 * 365))}y`;
  }

  YTCAL.core = {
    TAG,
    log,
    warn,
    clamp,
    parseLocalizedNumber,
    parseAgeHours,
    extractViews,
    parseMonthDate,
    ITEM_SELECTOR,
    findItems,
    isOutermost,
    getVideoId,
    isShort,
    extractMetadata,
    isViewsLabel,
    isAgeLabel,
    getRendererData,
    deepFind,
    wilsonLowerBound,
    smoothedVph,
    isLowQuality,
    analyze,
    bandForScore,
    componentLabel,
    scoreFromZ,
    WEIGHTS,
    REFERENCE,
    baselineOf,
    formatNumber,
    formatAgeHours,
  };
})();
