// watch-stats.js — quality row for the watched video (above the title).
// Facts (numbers) + exactly ONE qualitative verdict chip + a collapsible knowledge block.
// All judgment comes from core.analyze; this file never computes its own score.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const SEP = '<span class="ytcal-pipe">·</span>';
  const CHEVRON_DOWN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.707 8.793a1 1 0 00-1.414 0L12 14.086 6.707 8.793a1 1 0 10-1.414 1.414L12 16.914l6.707-6.707a1 1 0 000-1.414Z"></path></svg>';
  const CHEVRON_UP =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.293 15.207a1 1 0 001.414 0L12 9.914l5.293 5.293a1 1 0 101.414-1.414L12 7.086l-6.707 6.707a1 1 0 000 1.414Z"></path></svg>';

  YTCAL.WatchStatsFeature = class {
    #el = null;
    #html = "";
    #expanded = false;
    #dislikes = new Map();
    #loading = new Set();

    get enabled() {
      return !window.YTCAL_FEATURES || window.YTCAL_FEATURES.watchStats !== false;
    }

    start() {
      if (!this.enabled) {
        console.log("[ytcal] watchStats disabled");
        return;
      }
      this.render();
    }

    onNavigate() {
      this.#expanded = false;
      this.render();
    }

    onMutate() {
      this.render();
    }

    render() {
      if (!this.enabled) return;
      if (location.pathname !== "/watch") {
        this.#remove();
        return;
      }

      const host = document.querySelector("ytd-watch-metadata #above-the-fold");
      if (!host) return;

      const d = this.#collect();
      if (!d || d.views == null) return;

      const core = YTCAL.core;
      const a = core.analyze({
        views: d.views,
        ageHours: d.ageHours,
        durationSec: d.durationSec,
        likes: d.likes,
        comments: d.comments,
      });
      if (!a) return;

      if (d.videoId) this.#maybeLoadDislikes(d.videoId);

      if (!this.#el || !document.contains(this.#el)) {
        this.#el = document.createElement("div");
        this.#el.className = "ytcal-watch-stats";
        this.#html = "";
        this.#el.addEventListener("click", (e) => {
          if (e.target.closest(".ytcal-expand")) {
            e.preventDefault();
            e.stopPropagation();
            this.#toggle();
          }
        });
        const titleRow = host.querySelector("#title-row");
        host.insertBefore(this.#el, titleRow || host.firstChild);
      }

      const html = this.#template(d, a);
      if (html !== this.#html) {
        this.#html = html;
        this.#el.innerHTML = html;
      }
      this.#applyExpanded();
    }

    #toggle() {
      this.#expanded = !this.#expanded;
      this.#applyExpanded();
    }

    #applyExpanded() {
      if (!this.#el) return;
      const details = this.#el.querySelector(".ytcal-details");
      const btn = this.#el.querySelector(".ytcal-expand");
      if (details) details.classList.toggle("open", this.#expanded);
      if (btn) {
        btn.setAttribute("aria-expanded", this.#expanded ? "true" : "false");
        btn.innerHTML = this.#expanded ? CHEVRON_UP : CHEVRON_DOWN;
      }
    }

    #remove() {
      if (this.#el) {
        this.#el.remove();
        this.#el = null;
        this.#html = "";
      }
    }

    // Dislikes are not public since Dec 2021; the only source is the third-party
    // Return YouTube Dislike API (an estimate). Sent: video id only.
    #maybeLoadDislikes(id) {
      if (!id || this.#dislikes.has(id) || this.#loading.has(id)) return;
      this.#loading.add(id);
      fetch(`https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(id)}`, {
        credentials: "omit",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          this.#loading.delete(id);
          if (data && Number.isFinite(data.dislikes) && data.dislikes > 0) {
            this.#dislikes.set(id, data.dislikes);
            this.#html = "";
            this.render();
          }
        })
        .catch(() => this.#loading.delete(id));
    }

    #collect() {
      const core = YTCAL.core;
      const videoId = new URLSearchParams(location.search).get("v");

      const pr = window.ytInitialPlayerResponse || {};
      const vd = pr.videoDetails || {};
      const mf = (pr.microformat && pr.microformat.playerMicroformatRenderer) || {};
      const prMatches = !videoId || vd.videoId === videoId;

      const infoEl = document.querySelector("ytd-watch-info-text #info");
      const infoText = infoEl ? infoEl.textContent || "" : "";
      const tooltipEl = document.querySelector("ytd-watch-info-text tp-yt-paper-tooltip #tooltip");
      const tooltip = tooltipEl ? tooltipEl.textContent || "" : "";

      let views = prMatches && vd.viewCount ? parseInt(vd.viewCount, 10) : null;
      if (views == null) views = core.extractViews(infoText);
      if (views == null) views = core.extractViews(tooltip);
      if (views == null) {
        const vc = document.querySelector(
          "ytd-video-primary-info-renderer .view-count, ytd-video-view-count-renderer .view-count, #view-count"
        );
        if (vc) views = core.parseLocalizedNumber(vc.textContent);
      }

      let ageHours =
        prMatches && mf.publishDate
          ? (Date.now() - new Date(mf.publishDate).getTime()) / 3.6e6
          : null;
      if (ageHours == null) ageHours = core.parseAgeHours(infoText);
      if (ageHours == null) {
        const dt = core.parseMonthDate(tooltip);
        if (dt) ageHours = (Date.now() - dt.getTime()) / 3.6e6;
      }

      let durationSec = null;
      const vid = document.querySelector("video");
      if (vid && Number.isFinite(vid.duration) && vid.duration > 0) {
        durationSec = Math.round(vid.duration);
      } else {
        const dt = document.querySelector(".ytp-time-duration");
        if (dt) durationSec = core.parseDurationSec(dt.textContent);
      }

      return {
        videoId,
        views,
        ageHours,
        durationSec,
        likes: this.#readLikes(),
        comments: this.#readComments(),
      };
    }

    #readLikes() {
      const core = YTCAL.core;
      const btn = document.querySelector(
        "ytd-watch-metadata segmented-like-dislike-button-view-model like-button-view-model button, ytd-watch-metadata like-button-view-model button"
      );
      const label = btn ? btn.getAttribute("aria-label") || "" : "";
      const nums = (label.match(/\d[\d\s.,]*/g) || [])
        .map((s) => core.parseLocalizedNumber(s))
        .filter((n) => n != null && n > 0);
      return nums.length ? Math.max(...nums) : null;
    }

    #readComments() {
      const c = document.querySelector(
        "ytd-comments-header-renderer #count, ytd-comments-header-renderer #count-text, #comments #count"
      );
      return c ? YTCAL.core.parseLocalizedNumber(c.textContent) : null;
    }

    #template(d, a) {
      const core = YTCAL.core;
      const m = a.metrics;
      const t = (window.YTCAL_FEATURES && window.YTCAL_FEATURES.thresholds) || {};
      const cw = t.commentWeight != null ? t.commentWeight : 1;
      const baseVph = Math.max(0, Math.round(Math.pow(10, core.baselineOf("vph").mean) - 1));
      const baseEr = core.baselineOf("er").mean || 0.025;
      const erPct = m.rawRate != null ? (m.rawRate * 100).toFixed(2) : null;
      const dislikes = d.videoId ? this.#dislikes.get(d.videoId) : null;

      const lenNote =
        m.durFactor && Math.abs(m.durFactor - 1) > 0.01
          ? ` Length-adjusted ×${m.durFactor.toFixed(2)}.`
          : "";
      const velocityTip = m.recent
        ? `${Math.round(m.vph)} views/hour (smoothed). Typical ~${baseVph}/h — ${a.labels.velocity}.${lenNote}`
        : `${Math.round(m.vph)} views/hour (lifetime average; not used in the score for older videos).`;
      const engagementTip =
        m.rawRate != null
          ? `${erPct}% engagement = (likes + ${cw}×comments) / views. Typical ~${(baseEr * 100).toFixed(1)}% — ${a.labels.engagement}. Wilson 95% lower bound: ${(m.lb * 100).toFixed(2)}%.`
          : "";
      const scoreTxt =
        a.verdict === "Low" || a.verdict === "Suspicious" ? "" : ` (${Math.round(a.score)}/100)`;
      const why = a.reason ? ` · ${a.reason}` : "";
      const verdictTip = `${a.verdict}${scoreTxt}${why}. Reach: ${a.labels.reach} · Velocity: ${a.labels.velocity} · Engagement: ${m.engagementKnown ? a.labels.engagement : "unknown"}.`;

      // Group 1: facts (no claims).
      const row = [];
      row.push(`<span class="ytcal-stat" title="${core.formatNumber(m.views)} views">👁 <b>${core.formatNumber(m.views)}</b></span>`);
      row.push(`<span class="ytcal-stat" title="published ${core.formatAgeHours(m.ageHours)} ago">⏱ <b>${core.formatAgeHours(m.ageHours)}</b></span>`);
      if (m.durationSec != null) row.push(`<span class="ytcal-stat" title="video length">⏳ <b>${core.formatDurationSec(m.durationSec)}</b></span>`);
      if (m.likes != null) row.push(`<span class="ytcal-stat" title="${core.formatNumber(m.likes)} likes">👍 <b>${core.formatNumber(m.likes)}</b></span>`);
      if (dislikes != null) row.push(`<span class="ytcal-stat" title="Dislikes (estimated by Return YouTube Dislike)">👎 <b>${core.formatNumber(dislikes)}</b></span>`);
      if (m.comments != null) row.push(`<span class="ytcal-stat" title="${core.formatNumber(m.comments)} comments">💬 <b>${core.formatNumber(m.comments)}</b></span>`);
      row.push(`<span class="ytcal-stat" title="${velocityTip}">⚡ <b>${Math.round(m.vph)}/h</b></span>`);
      if (erPct != null) row.push(`<span class="ytcal-stat" title="${engagementTip}">❤️ <b>${erPct}%</b></span>`);
      row.push(`<span class="ytcal-badge ytcal-band-${a.band}" title="${verdictTip}">${a.verdict}${scoreTxt}</span>`);

      // Group 2: one-line verdict headline (visible) + collapsible knowledge.
      const head = this.#verdictHead(a, m);
      const details = this.#details(a, m, erPct);

      return (
        `<div class="ytcal-row">${row.join(SEP)}</div>` +
        `<div class="ytcal-verdict-line">${head}</div>` +
        `<div class="ytcal-details">${details}</div>` +
        `<button class="ytcal-expand" type="button" aria-expanded="false" aria-label="More details">${CHEVRON_DOWN}</button>`
      );
    }

    #verdictHead(a, m) {
      const weakRe = /low|below average/;
      const weak = [];
      if (weakRe.test(a.labels.reach)) weak.push("reach");
      if (m.recent && weakRe.test(a.labels.velocity)) weak.push("velocity");
      if (m.engagementKnown && weakRe.test(a.labels.engagement)) weak.push("engagement");
      const scoreTxt =
        a.verdict === "Low" || a.verdict === "Suspicious" ? "" : ` (${Math.round(a.score)}/100)`;
      const why = a.reason ? ` — ${a.reason}` : "";
      return `${a.verdict}${scoreTxt}${why}${
        weak.length ? ` · weak: <b>${weak.join(", ")}</b>` : " · no obvious weak spot"
      }${!m.engagementKnown ? " · reach &amp; velocity only" : ""}`;
    }

    // Collapsible details: snapshot, what to raise, glossary.
    #details(a, m, erPct) {
      const core = YTCAL.core;
      const tg = core.targets();
      const weakRe = /low|below average/;

      const snap = [`reach <b>${a.labels.reach}</b> (${core.formatNumber(m.views)})`];
      if (m.recent) snap.push(`velocity <b>${a.labels.velocity}</b> (${Math.round(m.vph)}/h)`);
      if (m.engagementKnown) snap.push(`engagement <b>${a.labels.engagement}</b> (${erPct}%)`);

      const order = ["Low", "Weak", "Average", "Good", "Strong", "Excellent", "Top"];
      const idx = order.indexOf(a.verdict);
      const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
      const targets = [];
      if (weakRe.test(a.labels.reach)) targets.push(`reach ≥ ${core.formatNumber(tg.viewsAbove)}`);
      if (m.recent && weakRe.test(a.labels.velocity)) targets.push(`velocity ≥ ${tg.vphAbove}/h`);
      if (m.engagementKnown && weakRe.test(a.labels.engagement))
        targets.push(`engagement ≥ ${(tg.erAbove * 100).toFixed(1)}%`);
      const guidance = next
        ? `To reach <b>${next}</b> raise: ${targets.length ? targets.join(" · ") : "any metric (already balanced)"}. High marks: reach ≥ ${core.formatNumber(tg.viewsHigh)} · velocity ≥ ${tg.vphHigh}/h · engagement ≥ ${(tg.erHigh * 100).toFixed(1)}%.`
        : `Already the top band. High marks: reach ≥ ${core.formatNumber(tg.viewsHigh)} · velocity ≥ ${tg.vphHigh}/h · engagement ≥ ${(tg.erHigh * 100).toFixed(1)}%.`;

      const glossary =
        "ER = (likes + comments) / views (share of viewers who react). VPH = views per hour. " +
        "Labels: low &lt; below average &lt; typical &lt; above average &lt; high.";

      return (
        `<span class="ytcal-verdict-line ytcal-muted">${snap.join(" · ")}</span>` +
        `<span class="ytcal-verdict-line ytcal-muted">${guidance}</span>` +
        `<span class="ytcal-verdict-line ytcal-muted">${glossary}</span>`
      );
    }
  };
})();
