// watch-stats.js — premium quality & monetization analytics card on the watch page.
// Displays non-redundant insights (verdict + score, velocity vs norm, Wilson ER, revenue range,
// category multiplier, SocialBlade link) and an expandable 3-column breakdown drawer.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const CHEVRON_DOWN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.707 8.793a1 1 0 00-1.414 0L12 14.086 6.707 8.793a1 1 0 10-1.414 1.414L12 16.914l6.707-6.707a1 1 0 000-1.414Z"></path></svg>';
  const CHEVRON_UP =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.293 15.207a1 1 0 001.414 0L12 9.914l5.293 5.293a1 1 0 101.414-1.414L12 7.086l-6.707 6.707a1 1 0 000 1.414Z"></path></svg>';

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
          ? (Date.now() - new Date(mf.publishDate).getTime()) / 3.6e6
          : null;
      if (ageHours == null) ageHours = core.parseAgeHours(infoText);
      if (ageHours == null) {
        const dt = core.parseMonthDate(tooltip);
        if (dt) ageHours = (Date.now() - dt.getTime()) / 3.6e6;
      }
      if (ageHours == null) {
        const metaDate = document.querySelector(
          'ytd-watch-flexy meta[itemprop="datePublished"], ytd-watch-flexy meta[itemprop="uploadDate"]'
        );
        const rawDate = metaDate ? metaDate.getAttribute("content") : null;
        if (rawDate) {
          const ts = new Date(rawDate).getTime();
          if (Number.isFinite(ts)) ageHours = Math.max(0.01, (Date.now() - ts) / 3.6e6);
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

    #template(d, a) {
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
        `<span class="ytcal-badge ytcal-band-${a.band}" title="${verdictTip}">${a.verdict}${scoreTxt}</span>`
      );

      // 2. Velocity insight pill
      pills.push(
        `<span class="ytcal-pill" title="${velocityTip}">` +
          `<span class="ytcal-pill-label">Tempo</span>` +
          `<b>${core.formatNumber(Math.round(m.vph))}/h</b>` +
          (vphMult ? `<span class="ytcal-pill-sub">${vphMult}</span>` : "") +
          `</span>`
      );

      // 3. Engagement insight pill
      if (erPct != null) {
        pills.push(
          `<span class="ytcal-pill" title="${engagementTip}">` +
            `<span class="ytcal-pill-label">ER</span>` +
            `<b>${erPct}%</b>` +
            (erMult ? `<span class="ytcal-pill-sub">${erMult}</span>` : "") +
            `</span>`
        );
      } else {
        pills.push(
          `<span class="ytcal-pill ytcal-pill-muted" title="${engagementTip}">` +
            `<span class="ytcal-pill-label">ER</span>` +
            `<b>—</b>` +
            `</span>`
        );
      }

      // 4. Monetization insight pill
      const rev = this.#revenue(d);
      if (rev) {
        const catTag = rev.category ? ` · ${rev.category}` : "";
        const mktTag = ` · ${rev.country}`;
        pills.push(
          `<span class="ytcal-pill ytcal-money" title="${this.#revenueTip(rev)}">` +
            `<span class="ytcal-pill-label">Estymacja</span>` +
            `<b>~${this.#pln(rev.low)}–${this.#pln(rev.high)} ${rev.currency}</b>` +
            `<span class="ytcal-pill-sub">RPM ${Math.round(rev.rpmLow)}–${Math.round(rev.rpmHigh)} zł${mktTag}${catTag}</span>` +
            `</span>`
        );
      }

      // 5. SocialBlade link
      const sbHref = this.#socialBladeUrl(d);
      if (sbHref) {
        pills.push(
          `<a class="ytcal-pill ytcal-sb-link" target="_blank" rel="noopener" href="${sbHref}" title="Otwórz statystyki kanału w SocialBlade (nowa karta)">SocialBlade ↗</a>`
        );
      }

      const details = this.#details(d, a, m, erPct, rev);

      return (
        `<div class="ytcal-row ytcal-row-clickable" title="Kliknij, aby rozwinąć pełną analizę modelu">${pills.join("")}</div>` +
        `<div class="ytcal-details">${details}</div>` +
        `<button class="ytcal-expand" type="button" aria-expanded="false" aria-label="Szczegóły analizy">${CHEVRON_DOWN}</button>`
      );
    }

    // Structured 3-column scorecard + monetization breakdown drawer.
    #details(d, a, m, erPct, rev) {
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

      const cards =
        `<div class="ytcal-grid">` +
        `<div class="ytcal-metric-card">` +
        `<div class="ytcal-metric-top"><span>Zasięg (${LABEL_PL[a.labels.reach] || a.labels.reach})</span><b>${core.formatNumber(m.views)} wyśw.</b></div>` +
        `<div class="ytcal-bar-track"><div class="ytcal-bar-fill" style="width:${reachSub}%"></div></div>` +
        `<div class="ytcal-metric-sub">${reachHint}</div>` +
        `</div>` +
        `<div class="ytcal-metric-card">` +
        `<div class="ytcal-metric-top"><span>Tempo (${LABEL_PL[a.labels.velocity] || a.labels.velocity})</span><b>${core.formatNumber(Math.round(m.vph))}/h</b></div>` +
        `<div class="ytcal-bar-track"><div class="ytcal-bar-fill" style="width:${m.recent ? velSub : 100}%;opacity:${m.recent ? 1 : 0.35}"></div></div>` +
        `<div class="ytcal-metric-sub">${velHint}</div>` +
        `</div>` +
        `<div class="ytcal-metric-card">` +
        `<div class="ytcal-metric-top"><span>Zaangażowanie (${LABEL_PL[a.labels.engagement] || a.labels.engagement})</span><b>${erPct != null ? erPct + "%" : "—"} (${likesCommentsTxt})</b></div>` +
        `<div class="ytcal-bar-track"><div class="ytcal-bar-fill" style="width:${engSub}%"></div></div>` +
        `<div class="ytcal-metric-sub">${engHint}</div>` +
        `</div>` +
        `</div>`;

      const langInfo = d && d.videoLang ? ` [${d.videoLang.toUpperCase()} · ${d.marketSource}]` : "";
      const moneyFooter = rev
        ? `<div class="ytcal-meta-footer">` +
          `<span><b>Model przychodu:</b> ~${this.#pln(rev.low)}–${this.#pln(rev.high)} ${rev.currency} (środek geom. ~${this.#pln(rev.revenue)} ${rev.currency})</span>` +
          `<span><b>Czas oglądania:</b> ~${this.#pln(rev.watchHoursLow)}–${this.#pln(rev.watchHoursHigh)} h</span>` +
          `<span><b>Retencja AVD:</b> ~${core.formatDurationSec(rev.avdLowSec)}–${core.formatDurationSec(rev.avdHighSec)}</span>` +
          `<span><b>Reklamy:</b> ${rev.adsPerView}–${rev.adsPerViewHigh} sloty/widza</span>` +
          `<span><b>Stawka:</b> CPM ${rev.country}${langInfo} ${rev.cpmPln} zł × nisza ${rev.nicheFactor}${rev.category ? ` (${rev.category})` : ""}</span>` +
          `</div>`
        : "";

      return cards + moneyFooter;
    }
  };
})();
