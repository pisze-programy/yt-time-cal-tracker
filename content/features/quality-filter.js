// quality-filter.js — blurs tiles whose verdict is filtered out and provides reveal/dismiss actions.
// Uses the same core.analyze verdict as the badge, so blur and badge can never disagree.
// The second-row chip bar (home feed only) toggles blur per verdict; default blurs Low.
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

  const REVEAL_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path></svg>';
  const DISMISS_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z"></path></svg>';

  YTCAL.QualityFilterFeature = class extends YTCAL.TileFeature {
    #revealed = new Set();
    #hidden = new Set(loadHidden());
    #bar = null;

    #isHidden(verdict) {
      if (!verdictFilterOn()) return verdict === "Low";
      return this.#hidden.has(verdict);
    }

    #scan = YTCAL.createTileScanner({
      // Already blurred with actions present -> nothing left to render.
      shouldSkip: (el) =>
        el.classList.contains("ytcal-low-quality") && !!el.querySelector(".ytcal-actions"),
      handle: (el, meta) => {
        const core = YTCAL.core;
        const id = core.getVideoId(el);
        if (id && this.#revealed.has(id)) el.classList.add("ytcal-revealed");
        if (meta.views == null) return;

        const a = core.analyze({
          views: meta.views,
          ageHours: meta.ageHours,
          durationSec: meta.durationSec,
        });
        if (!a) return;
        el.dataset.ytcalVerdict = a.verdict;

        if (this.#isHidden(a.verdict)) {
          el.classList.add("ytcal-low-quality");
          const label = el.querySelector(".ytcal-label");
          if (el.querySelector(".ytcal-actions")) {
            // keep the label in sync as YouTube fills in views/age late
            if (label) label.textContent = this.#labelText(meta, a.verdict);
          } else {
            this.#renderActions(el, id, meta, a.verdict);
          }
        } else {
          el.classList.remove("ytcal-low-quality");
        }
      },
    });

    constructor() {
      super("qualityFilter");
    }

    scan(ctx) {
      this.#scan(ctx);
      this.#ensureBar();
    }

    // --- verdict chip bar: a second row under the home feed chip bar ---

    #isHome() {
      return window.location.pathname === "/";
    }

    #ensureBar() {
      const show = this.enabled && verdictFilterOn() && this.#isHome();
      const existing = document.querySelector(".ytcal-filter-bar");
      if (!show) {
        if (existing) existing.remove();
        this.#bar = null;
        return;
      }
      if (existing) {
        this.#bar = existing;
        this.#syncBar();
        return;
      }
      const anchor = document.querySelector("ytd-feed-filter-chip-bar-renderer");
      if (!anchor) return;
      const bar = document.createElement("div");
      bar.className = "ytcal-filter-bar";
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Filtr werdyktów");
      for (const v of VERDICTS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `ytcal-filter-chip ytcal-band-${BAND[v]}`;
        b.dataset.verdict = v;
        b.textContent = v;
        b.setAttribute("aria-pressed", String(!this.#hidden.has(v)));
        b.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.#toggle(v);
        });
        bar.appendChild(b);
      }
      // Inside the renderer, not next to it: the renderer is the sticky element,
      // so a sibling scrolls away with the page.
      anchor.appendChild(bar);
      this.#bar = bar;
    }

    #syncBar() {
      if (!this.#bar) return;
      for (const b of this.#bar.querySelectorAll(".ytcal-filter-chip")) {
        b.setAttribute("aria-pressed", String(!this.#hidden.has(b.dataset.verdict)));
      }
    }

    #toggle(verdict) {
      if (this.#hidden.has(verdict)) this.#hidden.delete(verdict);
      else this.#hidden.add(verdict);
      saveHidden(this.#hidden);
      this.#syncBar();
      this.#applyToAll();
    }

    // Bypass the scanner throttle: a chip toggle applies immediately to every tile.
    #applyToAll() {
      const core = YTCAL.core;
      for (const el of core.findItems()) {
        if (!core.isOutermost(el) || core.isShort(el)) continue;
        const meta = core.extractMetadata(el);
        if (meta.views == null) continue;
        const a = core.analyze({
          views: meta.views,
          ageHours: meta.ageHours,
          durationSec: meta.durationSec,
        });
        if (!a) continue;
        el.dataset.ytcalVerdict = a.verdict;
        const id = core.getVideoId(el);
        if (this.#isHidden(a.verdict)) {
          el.classList.add("ytcal-low-quality");
          if (id && this.#revealed.has(id)) el.classList.add("ytcal-revealed");
          const label = el.querySelector(".ytcal-label");
          if (label) label.textContent = this.#labelText(meta, a.verdict);
          else this.#renderActions(el, id, meta, a.verdict);
        } else {
          el.classList.remove("ytcal-low-quality");
          const overlay = el.querySelector(".ytcal-overlay");
          if (overlay) overlay.remove();
          const actions = el.querySelector(".ytcal-actions");
          if (actions) actions.remove();
          const label = el.querySelector(".ytcal-label");
          if (label) label.remove();
        }
      }
    }

    #renderActions(el, id, meta, verdict) {
      if (el.querySelector(".ytcal-actions")) return;

      const overlay = document.createElement("div");
      overlay.className = "ytcal-overlay";
      overlay.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#reveal(el, id);
      });

      const actions = document.createElement("div");
      actions.className = "ytcal-actions";
      actions.innerHTML =
        `<button class="ytcal-btn ytcal-reveal" title="Reveal" aria-label="Reveal">${REVEAL_SVG}</button>` +
        `<button class="ytcal-btn ytcal-dismiss" title="Not interested" aria-label="Not interested">${DISMISS_SVG}</button>`;

      actions.querySelector(".ytcal-reveal").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#reveal(el, id);
      });
      actions.querySelector(".ytcal-dismiss").addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.#dismiss(el, id, e.currentTarget);
      });

      const label = document.createElement("div");
      label.className = "ytcal-label";
      label.textContent = this.#labelText(meta, verdict);

      el.appendChild(overlay);
      el.appendChild(actions);
      el.appendChild(label);
    }

    #labelText(meta, verdict) {
      const core = YTCAL.core;
      return `${verdict} · ${core.formatNumber(meta.views)} views · ${core.formatAgeHours(meta.ageHours)} ago`;
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
      el.style.display = "none";
      if (id) this.#revealed.delete(id);
    }
  };
})();
