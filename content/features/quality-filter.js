// quality-filter.js — blurs tiles whose verdict is "Low" and provides reveal/dismiss actions.
// Uses the same core.analyze verdict as the badge, so blur and badge can never disagree.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  const REVEAL_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"></path></svg>';
  const DISMISS_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1Zm0 2a9 9 0 018.246 12.605L4.755 6.661A8.99 8.99 0 0112 3ZM3.754 8.393l15.491 8.944A9 9 0 013.754 8.393Z"></path></svg>';

  YTCAL.QualityFilterFeature = class extends YTCAL.TileFeature {
    #revealed = new Set();

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

        if (a.verdict === "Low") {
          el.classList.add("ytcal-low-quality");
          const label = el.querySelector(".ytcal-label");
          if (el.querySelector(".ytcal-actions")) {
            // keep the label in sync as YouTube fills in views/age late
            if (label) label.textContent = this.#labelText(meta);
          } else {
            this.#renderActions(el, id, meta);
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
    }

    #renderActions(el, id, meta) {
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
      label.textContent = this.#labelText(meta);

      el.appendChild(overlay);
      el.appendChild(actions);
      el.appendChild(label);
    }

    #labelText(meta) {
      const core = YTCAL.core;
      return `Low quality · ${core.formatNumber(meta.views)} views · ${core.formatAgeHours(meta.ageHours)} ago`;
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
