// watch-stats.js — premium quality & monetization analytics card on the watch page.
// Displays non-redundant insights (verdict + score, velocity vs norm, Wilson ER, revenue range,
// category multiplier, SocialBlade link) and an expandable 3-column breakdown drawer.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const CHEVRON_DOWN_PATH =
    "M18.707 8.793a1 1 0 00-1.414 0L12 14.086 6.707 8.793a1 1 0 10-1.414 1.414L12 16.914l6.707-6.707a1 1 0 000-1.414Z";
  const CHEVRON_UP_PATH =
    "M5.293 15.207a1 1 0 001.414 0L12 9.914l5.293 5.293a1 1 0 101.414-1.414L12 7.086l-6.707 6.707a1 1 0 000 1.414Z";

  function createSvg(pathD) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === "className") node.className = v;
        else node.setAttribute(k, String(v));
      }
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  const LABEL_PL = {
    high: "Wysoki",
    "above average": "Powyżej normy",
    typical: "Typowy",
    "below average": "Poniżej normy",
    low: "Niski",
    "not weighted (old)": "Klasyk (ponad 3 dni)",
    unknown: "Brak danych",
  };

  function fmtMult(ratio) {
    if (!Number.isFinite(ratio) || ratio <= 0) return "";
    if (ratio >= 10) return `${Math.round(ratio)}× normy`;
    if (ratio >= 1.25 || ratio <= 0.8) return `${ratio.toFixed(1)}× normy`;
    return "w normie";
  }

  YTCAL.WatchStatsFeature = class {
    #el = null;
    #html = "";
    #expanded = false;
    #lastCollectAt = 0;
    #lastVideoId = null;
    #settled = false;

    get enabled() {
      return !window.YTCAL_FEATURES || window.YTCAL_FEATURES.watchStats !== false;
    }

    start() {
      if (!this.enabled) {
        console.log("[ytcal] watchStats disabled");
        return;
      }
      this.render(true);
    }

    onNavigate() {
      this.#expanded = false;
      this.#lastCollectAt = 0;
      this.#settled = false;
      this.render(true);
    }

    onMutate() {
      this.render(false);
    }

    // Quantize Date.now()-based age so render() diff keys stay stable across mutations
    // instead of changing every millisecond and rebuilding the card in a loop.
    #quantizeAgeHours(rawHours) {
      if (!Number.isFinite(rawHours)) return null;
      const h = Math.max(0.01, rawHours);
      if (h < 1) return Math.max(0.01, Math.round(h * 20) / 20); // 3-min buckets
      if (h < 72) return Math.round(h * 4) / 4; // 15-min buckets
      return Math.round(h); // 1-hour buckets
    }

    render(force = false) {
      if (!this.enabled) return;
      if (location.pathname !== "/watch") {
        this.#remove();
        this.#lastVideoId = null;
        this.#lastCollectAt = 0;
        this.#settled = false;
        return;
      }

      const videoId = new URLSearchParams(location.search).get("v");
      const now = performance.now();
      if (!force && videoId === this.#lastVideoId && this.#el && document.contains(this.#el)) {
        const minGap = this.#settled ? 15000 : 1000;
        if (now - this.#lastCollectAt < minGap) return;
      }

      const host = document.querySelector("ytd-watch-metadata #above-the-fold");
      if (!host) return;

      this.#lastCollectAt = now;
      this.#lastVideoId = videoId;

      const d = this.#collect();
      if (!d || d.views == null) return;
      this.#settled = d.likes != null;

      const core = YTCAL.core;
      const a = core.analyze({
        views: d.views,
        ageHours: d.ageHours,
        durationSec: d.durationSec,
        likes: d.likes,
        comments: d.comments,
      });
      if (!a) return;

      if (!this.#el || !document.contains(this.#el)) {
        this.#el = document.createElement("div");
        this.#el.className = "ytcal-watch-stats";
        this.#html = "";
        this.#el.addEventListener("click", (e) => {
          const sb = e.target.closest(".ytcal-sb-link");
          if (sb) {
            e.preventDefault();
            e.stopPropagation();
            window.open(sb.href, "_blank", "noopener");
            return;
          }
          if (e.target.closest(".ytcal-expand") || e.target.closest(".ytcal-row-clickable")) {
            e.preventDefault();
            e.stopPropagation();
            this.#toggle();
          }
        });
        const titleRow = host.querySelector("#title-row");
        host.insertBefore(this.#el, titleRow || host.firstChild);
      }

      const key = JSON.stringify([d, a.score, a.verdict, a.confidence]);
      if (key !== this.#html) {
        this.#html = key;
        this.#el.replaceChildren(...this.#buildNodes(d, a));
      }
      this.#applyExpanded();
    }

    #toggle() {
      this.#expanded = !this.#expanded;
      this.#applyExpanded();
    }

    #applyExpanded() {
      if (!this.#el) return;
      const want = this.#expanded ? "true" : "false";
      const details = this.#el.querySelector(".ytcal-details");
      if (details && details.classList.contains("open") !== this.#expanded) {
        details.classList.toggle("open", this.#expanded);
      }
      const btn = this.#el.querySelector(".ytcal-expand");
      if (btn && btn.getAttribute("aria-expanded") !== want) {
        btn.setAttribute("aria-expanded", want);
        btn.replaceChildren(createSvg(this.#expanded ? CHEVRON_UP_PATH : CHEVRON_DOWN_PATH));
      }
    }

    #remove() {
      if (this.#el) {
        this.#el.remove();
        this.#el = null;
        this.#html = "";
      }
    }

    // Reads the live player response for the current video across SPA navigations and Firefox Xrays.
    #readPlayerResponse(videoId) {
      const unwrap = YTCAL.core.unwrap || ((x) => x);
      const candidates = [];
      try {
        const player = unwrap(document.querySelector("#movie_player"));
        if (player && typeof player.getPlayerResponse === "function") {
          candidates.push(player.getPlayerResponse());
        }
      } catch (_) {}
      try {
        const flexy = unwrap(document.querySelector("ytd-watch-flexy"));
        if (flexy) {
          if (flexy.playerData) candidates.push(flexy.playerData);
          if (flexy.__data && flexy.__data.playerData) candidates.push(flexy.__data.playerData);
        }
      } catch (_) {}
      try {
        const win = unwrap(window);
        if (win && win.ytInitialPlayerResponse) candidates.push(win.ytInitialPlayerResponse);
      } catch (_) {}

      for (const pr of candidates) {
        if (!pr || typeof pr !== "object") continue;
        const vd = pr.videoDetails || {};
        if (!videoId || vd.videoId === videoId) return pr;
      }
      return {};
    }

    #collect() {
      const core = YTCAL.core;
      const videoId = new URLSearchParams(location.search).get("v");

      const pr = this.#readPlayerResponse(videoId);
      const vd = pr.videoDetails || {};
      const mf = (pr.microformat && pr.microformat.playerMicroformatRenderer) || {};
      const prMatches = Boolean(vd.videoId && (!videoId || vd.videoId === videoId));

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
      if (views == null) {
        const metaViews = document.querySelector(
          'ytd-watch-flexy meta[itemprop="interactionCount"], meta[itemprop="interactionCount"]'
        );
        if (metaViews) views = parseInt(metaViews.getAttribute("content") || "", 10) || null;
      }

      let ageHours =
        prMatches && mf.publishDate
          ? this.#quantizeAgeHours((Date.now() - new Date(mf.publishDate).getTime()) / 3.6e6)
          : null;
      if (ageHours == null) ageHours = core.parseAgeHours(infoText);
      if (ageHours == null) {
        const dt = core.parseMonthDate(tooltip);
        if (dt) ageHours = this.#quantizeAgeHours((Date.now() - dt.getTime()) / 3.6e6);
      }
      if (ageHours == null) {
        const metaDate = document.querySelector(
          'ytd-watch-flexy meta[itemprop="datePublished"], ytd-watch-flexy meta[itemprop="uploadDate"]'
        );
        const rawDate = metaDate ? metaDate.getAttribute("content") : null;
        if (rawDate) {
          const ts = new Date(rawDate).getTime();
          if (Number.isFinite(ts)) ageHours = this.#quantizeAgeHours((Date.now() - ts) / 3.6e6);
        }
      }

      let durationSec = prMatches && vd.lengthSeconds ? parseInt(vd.lengthSeconds, 10) : null;
      if (!durationSec) {
        const vid = document.querySelector("video");
        if (vid && Number.isFinite(vid.duration) && vid.duration > 0) {
          durationSec = Math.round(vid.duration);
        } else {
          const dt = document.querySelector(".ytp-time-duration");
          if (dt) durationSec = core.parseDurationSec(dt.textContent);
        }
      }

      let category = prMatches && mf.category ? String(mf.category) : null;
      if (!category) {
        const metaGenre = document.querySelector(
          'ytd-watch-flexy meta[itemprop="genre"], meta[itemprop="genre"]'
        );
        if (metaGenre) category = metaGenre.getAttribute("content") || null;
      }

      const { channelId, channelHandle } = this.#readChannel(prMatches ? vd.channelId : null);
      const market = this.#detectMarket(pr, vd, mf, prMatches);

      return {
        videoId,
        views,
        ageHours,
        durationSec,
        likes: this.#readLikes(),
        comments: this.#readComments(),
        channelId,
        channelHandle,
        category,
        country: market.country,
        videoLang: market.lang,
        marketSource: market.source,
      };
    }

    #detectMarket(pr, vd, mf, prMatches) {
      const core = YTCAL.core;
      let defaultLanguage = null;
      let audioLang = null;
      let asrLang = null;
      let captionLang = null;
      let title = "";
      let description = "";

      if (prMatches) {
        defaultLanguage =
          mf.defaultAudioLanguage || vd.defaultAudioLanguage || mf.defaultLanguage || null;
        title = vd.title || "";
        description = vd.shortDescription || "";

        const formats =
          (pr.streamingData && Array.isArray(pr.streamingData.adaptiveFormats)
            ? pr.streamingData.adaptiveFormats
            : []);
        for (const f of formats) {
          const at = f && f.audioTrack;
          if (!at || !at.id) continue;
          const isOrig =
            at.audioIsDefault || /orig|oryginal/i.test(String(at.displayName || ""));
          if (isOrig) {
            audioLang = String(at.id);
            break;
          }
          if (!audioLang) audioLang = String(at.id);
        }

        const tracks =
          (pr.captions &&
            pr.captions.playerCaptionsTracklistRenderer &&
            Array.isArray(pr.captions.playerCaptionsTracklistRenderer.captionTracks)
            ? pr.captions.playerCaptionsTracklistRenderer.captionTracks
            : []);
        for (const tr of tracks) {
          if (!tr || !tr.languageCode) continue;
          if (tr.kind === "asr" && !asrLang) asrLang = String(tr.languageCode);
          else if (!captionLang) captionLang = String(tr.languageCode);
        }
      }

      if (!title) {
        const h1 = document.querySelector(
          "ytd-watch-metadata h1 yt-formatted-string, h1.ytd-video-primary-info-renderer"
        );
        if (h1) title = (h1.textContent || "").trim();
      }
      if (!description) {
        const desc = document.querySelector(
          "ytd-watch-metadata #description-inline-expander, #description"
        );
        if (desc) description = (desc.textContent || "").trim();
      }

      return core.detectVideoMarket({
        defaultLanguage,
        audioLang,
        asrLang,
        captionLang,
        title,
        description,
        fallbackCountry: this.#readCountry(),
      });
    }

    #readChannel(prChannelId) {
      let channelId = prChannelId || null;
      let channelHandle = null;
      const links = document.querySelectorAll(
        'ytd-watch-metadata ytd-video-owner-renderer a[href], ytd-watch-flexy link[itemprop="url"][href]'
      );
      for (const a of links) {
        const href = a.getAttribute("href") || "";
        const mCh = href.match(/\/channel\/(UC[\w-]{15,})/);
        if (mCh && !channelId) channelId = mCh[1];
        const mH = href.match(/\/(@[\w.-]+)/);
        if (mH && !channelHandle) channelHandle = mH[1];
      }
      return { channelId, channelHandle };
    }

    // Viewer market (ytcfg / topbar).
    #readCountry() {
      const unwrap = YTCAL.core.unwrap || ((x) => x);
      try {
        const win = unwrap(window);
        const cfg = win && win.ytcfg;
        const c = cfg && typeof cfg.get === "function" ? cfg.get("COUNTRY") : null;
        if (c) return String(c).toUpperCase();
        if (cfg && cfg.data_ && cfg.data_.INNERTUBE_CONTEXT_GL) {
          return String(cfg.data_.INNERTUBE_CONTEXT_GL).toUpperCase();
        }
        const tb =
          win &&
          win.ytInitialData &&
          win.ytInitialData.topbar &&
          win.ytInitialData.topbar.desktopTopbarRenderer;
        if (tb && tb.countryCode) return String(tb.countryCode).toUpperCase();
      } catch (_) {}
      const gl = document.querySelector("ytd-topbar-logo-renderer #country-code");
      if (gl && gl.textContent && gl.textContent.trim()) {
        return gl.textContent.trim().toUpperCase();
      }
      return null;
    }

    #revenue(d) {
      const F = window.YTCAL_FEATURES || {};
      if (F.monetization === false) return null;
      return YTCAL.core.estimateRevenue({
        views: d.views,
        durationSec: d.durationSec,
        category: d.category,
        country: d.country,
      });
    }

    #pln(n) {
      if (!Number.isFinite(n)) return "—";
      return Math.round(n).toLocaleString("pl-PL");
    }

    #revenueTip(r) {
      const core = YTCAL.core;
      return (
        `Szacowany przychód ~${this.#pln(r.low)}–${this.#pln(r.high)} ${r.currency} (przedział casual → engaged). ` +
        `Czas oglądania: ~${this.#pln(r.watchHoursLow)}–${this.#pln(r.watchHoursHigh)} h, AVD ` +
        `~${core.formatDurationSec(r.avdLowSec)}–${core.formatDurationSec(r.avdHighSec)}, ` +
        `${r.adsPerView}–${r.adsPerViewHigh} reklam/widza, CPM ${r.country} ${r.cpmPln} zł × nisza ${r.nicheFactor}.`
      );
    }

    #readLikes() {
      const core = YTCAL.core;
      const btn = document.querySelector(
        "ytd-watch-metadata segmented-like-dislike-button-view-model like-button-view-model button, ytd-watch-metadata like-button-view-model button"
      );
      if (!btn) return null;
      const label = btn.getAttribute("aria-label") || "";
      const nums = (label.match(/\d[\d\s.,]*/g) || [])
        .map((s) => core.parseLocalizedNumber(s))
        .filter((n) => n != null && n > 0);
      if (nums.length) return Math.max(...nums);
      const txt = (btn.textContent || "").trim();
      return core.parseLocalizedNumber(txt);
    }

    #readComments() {
      const c = document.querySelector(
        "ytd-comments-header-renderer #count, ytd-comments-header-renderer #count-text, #comments #count"
      );
      return c ? YTCAL.core.parseLocalizedNumber(c.textContent) : null;
    }

    #socialBladeUrl(d) {
      if (d.channelId) return `https://socialblade.com/youtube/channel/${d.channelId}`;
      if (d.channelHandle) return `https://socialblade.com/youtube/handle/${encodeURIComponent(d.channelHandle)}`;
      return null;
    }

    #buildNodes(d, a) {
      const core = YTCAL.core;
      const m = a.metrics;
      const t = (window.YTCAL_FEATURES && window.YTCAL_FEATURES.thresholds) || {};
      const cw = t.commentWeight != null ? t.commentWeight : 1;
      const baseVph = Math.max(0, Math.round(Math.pow(10, core.baselineOf("vph").mean) - 1));
      const baseEr = core.baselineOf("er").mean || 0.025;
      const erPct = m.rawRate != null ? (m.rawRate * 100).toFixed(2) : null;

      const scoreTxt =
        a.verdict === "Low" || a.verdict === "Suspicious" ? "" : ` · ${Math.round(a.score)}/100`;
      const why = a.reason ? ` (${a.reason})` : "";
      const verdictTip = `${a.verdict}${scoreTxt}${why}. Zasięg: ${a.labels.reach} · Tempo: ${a.labels.velocity} · Zaangażowanie: ${m.engagementKnown ? a.labels.engagement : "brak danych"}.`;

      const vphMult = m.recent ? fmtMult(m.vphRatio) : "klasyk";
      const velocityTip = m.recent
        ? `${Math.round(m.vph)} wyśw./h (skorygowane o długość: ${Math.round(m.vphAdj)}/h vs baza ~${baseVph}/h)`
        : `${Math.round(m.vph)} wyśw./h (średnia życiowa; dla filmów >72h liczy się łączny zasięg)`;

      const erMult = m.erRatio != null ? fmtMult(m.erRatio) : "";
      const engagementTip =
        m.rawRate != null
          ? `${erPct}% zaangażowania = (polubienia + ${cw}×komentarze) / wyświetlenia. Dolna granica Wilsona 95%: ${(m.lb * 100).toFixed(2)}% (baza ~${(baseEr * 100).toFixed(1)}%).`
          : "Polubienia są ukryte lub jeszcze się ładują";

      const pills = [];
      // 1. Primary Verdict + Score pill
      pills.push(
        h("span", { className: `ytcal-badge ytcal-band-${a.band}`, title: verdictTip }, `${a.verdict}${scoreTxt}`)
      );

      // 2. Velocity insight pill
      pills.push(
        h(
          "span",
          { className: "ytcal-pill", title: velocityTip },
          h("span", { className: "ytcal-pill-label" }, "Tempo"),
          h("b", null, `${core.formatNumber(Math.round(m.vph))}/h`),
          vphMult ? h("span", { className: "ytcal-pill-sub" }, vphMult) : null
        )
      );

      // 3. Engagement insight pill
      if (erPct != null) {
        pills.push(
          h(
            "span",
            { className: "ytcal-pill", title: engagementTip },
            h("span", { className: "ytcal-pill-label" }, "ER"),
            h("b", null, `${erPct}%`),
            erMult ? h("span", { className: "ytcal-pill-sub" }, erMult) : null
          )
        );
      } else {
        pills.push(
          h(
            "span",
            { className: "ytcal-pill ytcal-pill-muted", title: engagementTip },
            h("span", { className: "ytcal-pill-label" }, "ER"),
            h("b", null, "—")
          )
        );
      }

      // 4. Monetization insight pill
      const rev = this.#revenue(d);
      if (rev) {
        const catTag = rev.category ? ` · ${rev.category}` : "";
        const mktTag = ` · ${rev.country}`;
        pills.push(
          h(
            "span",
            { className: "ytcal-pill ytcal-money", title: this.#revenueTip(rev) },
            h("span", { className: "ytcal-pill-label" }, "Estymacja"),
            h("b", null, `~${this.#pln(rev.low)}–${this.#pln(rev.high)} ${rev.currency}`),
            h("span", { className: "ytcal-pill-sub" }, `RPM ${Math.round(rev.rpmLow)}–${Math.round(rev.rpmHigh)} zł${mktTag}${catTag}`)
          )
        );
      }

      // 5. SocialBlade link
      const sbHref = this.#socialBladeUrl(d);
      if (sbHref) {
        pills.push(
          h(
            "a",
            {
              className: "ytcal-pill ytcal-sb-link",
              target: "_blank",
              rel: "noopener",
              href: sbHref,
              title: "Otwórz statystyki kanału w SocialBlade (nowa karta)",
            },
            "SocialBlade ↗"
          )
        );
      }

      const row = h(
        "div",
        { className: "ytcal-row ytcal-row-clickable", title: "Kliknij, aby rozwinąć pełną analizę modelu" },
        ...pills
      );
      const details = h("div", { className: "ytcal-details" }, ...this.#detailsNodes(d, a, m, erPct, rev));
      const expandBtn = h(
        "button",
        { className: "ytcal-expand", type: "button", "aria-expanded": "false", "aria-label": "Szczegóły analizy" },
        createSvg(CHEVRON_DOWN_PATH)
      );

      return [row, details, expandBtn];
    }

    // Structured 3-column scorecard + monetization breakdown drawer.
    #detailsNodes(d, a, m, erPct, rev) {
      const core = YTCAL.core;
      const tg = core.targets();
      const sub = a.subscores || { reach: 50, velocity: 50, engagement: 50 };

      const reachSub = sub.reach != null ? sub.reach : 50;
      const velSub = sub.velocity != null ? sub.velocity : 50;
      const engSub = sub.engagement != null ? sub.engagement : 0;

      const reachHint =
        m.views < tg.viewsAbove
          ? `Cel powyższej normy: ≥ ${core.formatNumber(tg.viewsAbove)} wyśw.`
          : m.views < tg.viewsHigh
          ? `Cel wysokiego zasięgu: ≥ ${core.formatNumber(tg.viewsHigh)} wyśw.`
          : `Wysoki pułap osiągnięty (≥ ${core.formatNumber(tg.viewsHigh)})`;

      const velHint = !m.recent
        ? `Film ma ${core.formatAgeHours(m.ageHours)} — ocena oparta na łącznym zasięgu`
        : m.vphAdj < tg.vphAbove
        ? `Cel powyższej normy: ≥ ${tg.vphAbove}/h (skoryg. ×${m.durFactor.toFixed(2)})`
        : m.vphAdj < tg.vphHigh
        ? `Cel wysokiego tempa: ≥ ${tg.vphHigh}/h (skoryg. ×${m.durFactor.toFixed(2)})`
        : `Wysokie tempo utrzymane (skoryg. ×${m.durFactor.toFixed(2)})`;

      const engHint = !m.engagementKnown
        ? `Polubienia niedostępne — wynik oparty na zasięgu i tempie (pewność ${Math.round(a.confidence * 100)}%)`
        : m.lb < tg.erAbove
        ? `Cel powyższej normy: ≥ ${(tg.erAbove * 100).toFixed(1)}% (Wilson LB: ${(m.lb * 100).toFixed(2)}%)`
        : m.lb < tg.erHigh
        ? `Cel wysokiego ER: ≥ ${(tg.erHigh * 100).toFixed(1)}% (Wilson LB: ${(m.lb * 100).toFixed(2)}%)`
        : `Wysokie zaangażowanie (Wilson LB: ${(m.lb * 100).toFixed(2)}%)`;

      const likesCommentsTxt = m.engagementKnown
        ? `${core.formatNumber(m.likes)} 👍` + (m.comments != null ? ` · ${core.formatNumber(m.comments)} 💬` : "")
        : "Brak danych";

      const grid = h(
        "div",
        { className: "ytcal-grid" },
        h(
          "div",
          { className: "ytcal-metric-card" },
          h(
            "div",
            { className: "ytcal-metric-top" },
            h("span", null, `Zasięg (${LABEL_PL[a.labels.reach] || a.labels.reach})`),
            h("b", null, `${core.formatNumber(m.views)} wyśw.`)
          ),
          h("div", { className: "ytcal-bar-track" }, h("div", { className: "ytcal-bar-fill", style: `width:${reachSub}%` })),
          h("div", { className: "ytcal-metric-sub" }, reachHint)
        ),
        h(
          "div",
          { className: "ytcal-metric-card" },
          h(
            "div",
            { className: "ytcal-metric-top" },
            h("span", null, `Tempo (${LABEL_PL[a.labels.velocity] || a.labels.velocity})`),
            h("b", null, `${core.formatNumber(Math.round(m.vph))}/h`)
          ),
          h(
            "div",
            { className: "ytcal-bar-track" },
            h("div", { className: "ytcal-bar-fill", style: `width:${m.recent ? velSub : 100}%;opacity:${m.recent ? 1 : 0.35}` })
          ),
          h("div", { className: "ytcal-metric-sub" }, velHint)
        ),
        h(
          "div",
          { className: "ytcal-metric-card" },
          h(
            "div",
            { className: "ytcal-metric-top" },
            h("span", null, `Zaangażowanie (${LABEL_PL[a.labels.engagement] || a.labels.engagement})`),
            h("b", null, `${erPct != null ? erPct + "%" : "—"} (${likesCommentsTxt})`)
          ),
          h("div", { className: "ytcal-bar-track" }, h("div", { className: "ytcal-bar-fill", style: `width:${engSub}%` })),
          h("div", { className: "ytcal-metric-sub" }, engHint)
        )
      );

      if (!rev) return [grid];

      const langInfo = d && d.videoLang ? ` [${d.videoLang.toUpperCase()} · ${d.marketSource}]` : "";
      const footer = h(
        "div",
        { className: "ytcal-meta-footer" },
        h("span", null, h("b", null, "Model przychodu:"), ` ~${this.#pln(rev.low)}–${this.#pln(rev.high)} ${rev.currency} (środek geom. ~${this.#pln(rev.revenue)} ${rev.currency})`),
        h("span", null, h("b", null, "Czas oglądania:"), ` ~${this.#pln(rev.watchHoursLow)}–${this.#pln(rev.watchHoursHigh)} h`),
        h("span", null, h("b", null, "Retencja AVD:"), ` ~${core.formatDurationSec(rev.avdLowSec)}–${core.formatDurationSec(rev.avdHighSec)}`),
        h("span", null, h("b", null, "Reklamy:"), ` ${rev.adsPerView}–${rev.adsPerViewHigh} sloty/widza`),
        h("span", null, h("b", null, "Stawka:"), ` CPM ${rev.country}${langInfo} ${rev.cpmPln} zł × nisza ${rev.nicheFactor}${rev.category ? ` (${rev.category})` : ""}`)
      );

      return [grid, footer];
    }
  };
})();
