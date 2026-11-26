// quality-filter.js — blurs tiles whose verdict is filtered out and provides reveal/dismiss actions.
// Uses the same core.analyze verdict as the badge, so blur and badge can never disagree.
// The floating bottom chip bar (always visible across YouTube, hidden in fullscreen)
// toggles blur per verdict; default blurs Low.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  const VERDICTS = ["Low", "Weak", "Average", "Good", "Strong", "Excellent", "Top", "Suspicious"];
  const BAND = {
    Low: "low",
    Weak: "weak",
    Average: "average",
    Good: "good",
    Strong: "strong",
    Excellent: "excellent",
    Top: "top",
    Suspicious: "suspicious",
  };

  function verdictFilterOn() {
    return !window.YTCAL_FEATURES || window.YTCAL_FEATURES.verdictFilter !== false;
  }

  function defaultHidden() {
    const f = window.YTCAL_FEATURES || {};
    return Array.isArray(f.verdictHiddenByDefault) ? f.verdictHiddenByDefault.slice() : ["Low"];
  }

  // Pure predicate (unit-tested): is this verdict currently blurred?
  function shouldBlurVerdict(verdict, hidden) {
    return (hidden || []).indexOf(verdict) !== -1;
  }

  // Persisted across reloads and tabs (same origin). Falls back to the flag
  // default when nothing is stored yet or storage is unavailable.
  const STORE_KEY = "ytcal.verdictHidden";
  function loadHidden() {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw == null) return defaultHidden();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return defaultHidden();
      const known = arr.filter((v) => VERDICTS.indexOf(v) !== -1);
      return known.length || arr.length === 0 ? known : defaultHidden();
    } catch (_) {
      return defaultHidden();
    }
  }
  function saveHidden(hidden) {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(hidden)));
    } catch (_) {}
  }

  YTCAL.VERDICT_CHIPS = VERDICTS;
  YTCAL.verdictShouldBlur = shouldBlurVerdict;

  const REVEAL_PATH =
    "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";
  const DISMISS_PATH =
    "M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z";

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

  YTCAL.QualityFilterFeature = class extends YTCAL.TileFeature {
    #revealed = new Set();
    #hidden = new Set(loadHidden());
    #bar = null;
    #listenersBound = false;

    #isHidden(verdict) {
      if (!verdictFilterOn()) return verdict === "Low";
      return this.#hidden.has(verdict);
    }

    #scan = YTCAL.createTileScanner({
      // Intact check: when blurred, the overlay and action buttons must be present.
      shouldSkip: (el) =>
        el.classList.contains("ytcal-low-quality") && !!el.querySelector(".ytcal-actions"),
      handle: (el, meta) => {
        this.#applyToTile(el, meta);
      },
    });

    constructor() {
      super("qualityFilter");
    }

    scan(ctx) {
      this.#scan(ctx);
      this.#ensureBar();
    }

    // --- unified floating bottom verdict chip bar ---

    #isFullscreen() {
      return Boolean(
        document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.querySelector(
            "ytd-watch-flexy[fullscreen], ytd-app[fullscreen], .html5-video-player.ytp-fullscreen"
          )
      );
    }

    #syncFullscreen() {
      if (!this.#bar) return;
      const fs = this.#isFullscreen();
      if (this.#bar.hidden !== fs) this.#bar.hidden = fs;
    }

    #ensureBar() {
      const show = this.enabled && verdictFilterOn();
      const existing = this.#bar && document.contains(this.#bar)
        ? this.#bar
        : document.querySelector(".ytcal-filter-bar");
      if (!show) {
        if (existing) existing.remove();
        this.#bar = null;
        return;
      }
      if (!document.body) return;

      if (existing) {
        if (this.#bar !== existing) {
          this.#bar = existing;
          this.#syncBar();
        }
        this.#syncFullscreen();
        return;
      }

      const bar = document.createElement("div");
      bar.className = "ytcal-filter-bar";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Filtr werdyktów");
      for (const v of VERDICTS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `ytcal-filter-chip ytcal-band-${BAND[v]}`;
        b.dataset.verdict = v;
        const chipName = document.createElement("span");
        chipName.className = "ytcal-chip-name";
        chipName.textContent = v;
        b.appendChild(chipName);
        b.setAttribute("aria-pressed", String(!this.#hidden.has(v)));
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.#toggle(v);
        });
        bar.appendChild(b);
      }

      document.body.appendChild(bar);
      this.#bar = bar;
      this.#syncBar();
      this.#syncFullscreen();

      if (!this.#listenersBound) {
        this.#listenersBound = true;
        const onFs = () => this.#syncFullscreen();
        document.addEventListener("fullscreenchange", onFs);
        document.addEventListener("webkitfullscreenchange", onFs);
        window.addEventListener("storage", (e) => {
          if (e.key === STORE_KEY) {
            this.#hidden = new Set(loadHidden());
            this.#syncBar();
            this.#applyToAll();
          }
        });
      }
    }

    #syncBar() {
      if (!this.#bar) return;
      for (const b of this.#bar.querySelectorAll(".ytcal-filter-chip")) {
        const v = b.dataset.verdict;
        const active = !this.#hidden.has(v);
        b.setAttribute("aria-pressed", String(active));
        b.title = active
          ? `${v}: widoczne — kliknij, aby ukrywać (blur)`
          : `${v}: ukrywane (blur) — kliknij, aby pokazywać`;
      }
    }

    #toggle(verdict) {
      if (this.#hidden.has(verdict)) this.#hidden.delete(verdict);
      else this.#hidden.add(verdict);
      saveHidden(this.#hidden);
      this.#syncBar();
      this.#applyToAll();
    }

    #clearBlur(el) {
      el.classList.remove("ytcal-low-quality");
      const overlay = el.querySelector(".ytcal-overlay");
      if (overlay) overlay.remove();
      const actions = el.querySelector(".ytcal-actions");
      if (actions) actions.remove();
    }

    #applyToTile(el, meta) {
      const core = YTCAL.core;
      const id = core.getVideoId(el);

      // If YouTube recycled a previously dismissed tile node for a new video, unhide it.
      if (el.dataset.ytcalDismissedId && el.dataset.ytcalDismissedId !== (id || "")) {
        delete el.dataset.ytcalDismissedId;
        if (el.style.display === "none") el.style.display = "";
      }

      el.classList.toggle("ytcal-revealed", Boolean(id && this.#revealed.has(id)));

      if (meta.views == null) {
        this.#clearBlur(el);
        return;
      }

      const a = core.analyze({
        views: meta.views,
        ageHours: meta.ageHours,
        durationSec: meta.durationSec,
      });
      if (!a) {
        this.#clearBlur(el);
        return;
      }
      el.dataset.ytcalVerdict = a.verdict;

      if (this.#isHidden(a.verdict)) {
        el.classList.add("ytcal-low-quality");
        if (!el.querySelector(".ytcal-actions")) {
          this.#renderActions(el);
        }
      } else {
        this.#clearBlur(el);
      }
    }

    // Bypass the scanner throttle: a chip toggle applies immediately to every tile.
    #applyToAll() {
      const core = YTCAL.core;
      for (const el of core.findItems()) {
        if (!core.isOutermost(el) || core.isShort(el)) continue;
        const meta = core.extractMetadata(el);
        this.#applyToTile(el, meta);
      }
    }

    #renderActions(el) {
      if (el.querySelector(".ytcal-actions")) return;

      const overlay = document.createElement("div");
      overlay.className = "ytcal-overlay";
      overlay.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#reveal(el, YTCAL.core.getVideoId(el));
      });

      const actions = document.createElement("div");
      actions.className = "ytcal-actions";

      const revealBtn = document.createElement("button");
      revealBtn.className = "ytcal-btn ytcal-reveal";
      revealBtn.title = "Reveal";
      revealBtn.setAttribute("aria-label", "Reveal");
      revealBtn.appendChild(createSvg(REVEAL_PATH));
      revealBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#reveal(el, YTCAL.core.getVideoId(el));
      });

      const dismissBtn = document.createElement("button");
      dismissBtn.className = "ytcal-btn ytcal-dismiss";
      dismissBtn.title = "Not interested";
      dismissBtn.setAttribute("aria-label", "Not interested");
      dismissBtn.appendChild(createSvg(DISMISS_PATH));
      dismissBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#dismiss(el, YTCAL.core.getVideoId(el), e.currentTarget);
      });

      actions.append(revealBtn, dismissBtn);

      el.appendChild(overlay);
      el.appendChild(actions);
    }

    #reveal(el, id) {
      el.classList.add("ytcal-revealed");
      if (id) this.#revealed.add(id);
    }

    async #dismiss(el, id, btn) {
      try {
        if (btn) btn.disabled = true;
        await YTCAL.feedback.sendNotInterested(el, id);
      } catch (err) {
        YTCAL.core.warn("dismiss failed", err);
      }
      el.dataset.ytcalDismissedId = id || "__unknown__";
      el.style.display = "none";
      if (id) this.#revealed.delete(id);
    }
  };
})();
