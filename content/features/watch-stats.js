// watch-stats.js — quality row for the watched video (above the title).
// Facts (numbers) + derived quantities + exactly ONE qualitative verdict chip.
// All judgment comes from core.analyze; this file never computes its own score.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const SEP = '<span class="ytcal-pipe">·</span>';

  YTCAL.WatchStatsFeature = class {
    #el = null;
    #html = "";

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
        likes: d.likes,
        comments: d.comments,
      });
      if (!a) return;

      // Observe once per video (deduplicated in core); scoring itself is pure.
      core.observe(d.videoId, { views: d.views, ageHours: d.ageHours, lb: a.metrics.lb });

      if (!this.#el || !document.contains(this.#el)) {
        this.#el = document.createElement("div");
        this.#el.className = "ytcal-watch-stats";
        this.#html = "";
        const titleRow = host.querySelector("#title-row");
        host.insertBefore(this.#el, titleRow || host.firstChild);
      }

      const html = this.#template(d, a);
      if (html !== this.#html) {
        this.#html = html;
        this.#el.innerHTML = html;
      }
    }

    #remove() {
      if (this.#el) {
        this.#el.remove();
        this.#el = null;
        this.#html = "";
      }
    }

    #collect() {
      const core = YTCAL.core;
      const videoId = new URLSearchParams(location.search).get("v");

      const pr = window.ytInitialPlayerResponse || {};
      const vd = pr.videoDetails || {};
      const mf = (pr.microformat && pr.microformat.playerMicroformatRenderer) || {};
      // ytInitialPlayerResponse can be stale after SPA navigation — only trust it for the same video.
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

      return { videoId, views, ageHours, likes: this.#readLikes(), comments: this.#readComments() };
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

      const baseVph = Math.max(0, Math.round(Math.pow(10, core.baselineOf("vph").mean) - 1));
      const baseEr = core.baselineOf("er").mean || 0.025;
      const erPct = m.rawRate != null ? (m.rawRate * 100).toFixed(2) : null;

      const velocityTip = m.recent
        ? `${Math.round(m.vph)} views/hour (smoothed). Your usual: ~${baseVph}/h — ${a.labels.velocity}.`
        : `${Math.round(m.vph)} views/hour (lifetime average; not used in the score for older videos).`;
      const engagementTip =
        m.rawRate != null
          ? `${erPct}% engagement = (likes + 3×comments) / views. Your usual: ~${(baseEr * 100).toFixed(1)}% — ${a.labels.engagement}. Wilson 95% lower bound: ${(m.lb * 100).toFixed(2)}%.`
          : "";
      const verdictTip = `${a.verdict} (${Math.round(a.score)}/100)${a.reason ? " · " + a.reason : ""}. Reach: ${a.labels.reach} · Velocity: ${a.labels.velocity} · Engagement: ${m.engagementKnown ? a.labels.engagement : "unknown"}.`;

      const parts = [];
      parts.push(`<span class="ytcal-stat" title="${core.formatNumber(m.views)} views">👁 <b>${core.formatNumber(m.views)}</b></span>`);
      parts.push(`<span class="ytcal-stat" title="published ${core.formatAgeHours(m.ageHours)} ago">⏱ <b>${core.formatAgeHours(m.ageHours)}</b></span>`);
      if (m.likes != null) parts.push(`<span class="ytcal-stat" title="${core.formatNumber(m.likes)} likes">👍 <b>${core.formatNumber(m.likes)}</b></span>`);
      if (m.comments != null) parts.push(`<span class="ytcal-stat" title="${core.formatNumber(m.comments)} comments">💬 <b>${core.formatNumber(m.comments)}</b></span>`);
      parts.push(`<span class="ytcal-stat" title="${velocityTip}">⚡ <b>${Math.round(m.vph)}/h</b></span>`);
      if (erPct != null) parts.push(`<span class="ytcal-stat" title="${engagementTip}">❤️ <b>${erPct}%</b></span>`);

      if (!m.engagementKnown) {
        parts.push(
          `<span class="ytcal-badge ytcal-band-average ytcal-muted" title="${verdictTip}">reach &amp; velocity only</span>`
        );
      } else {
        parts.push(`<span class="ytcal-badge ytcal-band-${a.band}" title="${verdictTip}">${a.verdict}</span>`);
      }

      const line = `<span class="ytcal-verdict-line">${this.#verdictLine(a, m, baseVph, baseEr)}</span>`;
      return parts.join(SEP) + line;
    }

    // Human-readable explanation that reuses the per-component labels from core.analyze,
    // so the visible words and the aggregate can never disagree.
    #verdictLine(a, m, baseVph, baseEr) {
      const usual = `your usual ~${baseVph}/h · ~${(baseEr * 100).toFixed(1)}% ER`;
      if (!m.engagementKnown) {
        return `Judged on reach &amp; velocity only — vs your feed: reach <b>${a.labels.reach}</b> · velocity <b>${a.labels.velocity}</b>. Likes/comments unavailable.`;
      }
      const why = a.reason ? ` — ${a.reason}` : "";
      return `${a.verdict} <span class="ytcal-muted">(${Math.round(a.score)}/100${why})</span> · vs your feed: reach <b>${a.labels.reach}</b> · velocity <b>${a.labels.velocity}</b> · engagement <b>${a.labels.engagement}</b> · ${usual}.`;
    }
  };
})();
