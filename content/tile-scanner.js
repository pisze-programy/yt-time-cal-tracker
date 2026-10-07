// tile-scanner.js — shared tile-scan mechanism for feed / search / sidebar features.
//
// Two building blocks, so tile features stop duplicating the same logic:
//   • createTileScanner(...) — throttled per-tile loop with metadata-settle tracking.
//   • TileFeature            — base class with the shared enable + lifecycle
//                              (start / onNavigate / onMutate); a subclass only
//                              implements scan(ctx).
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  const DEFAULT_RESCAN_MS = 30000; // re-evaluate a settled tile at most this often
  const DEFAULT_RETRY_MS = 500; // retry while the tile's views are still unknown

  // Returns scan(ctx): walks ctx.items once and calls handle(el, meta, ctx) at most
  // once per rescanMs (retryMs while meta.views is still settling). shouldSkip(el),
  // checked first, lets a feature cheaply ignore tiles that are already up to date.
  function createTileScanner({ rescanMs, retryMs, shouldSkip, handle } = {}) {
    const rescan = rescanMs != null ? rescanMs : DEFAULT_RESCAN_MS;
    const retry = retryMs != null ? retryMs : DEFAULT_RETRY_MS;
    const seen = new WeakMap();

    return function scan(ctx) {
      const core = YTCAL.core;
      ctx = ctx || core.createScanContext();
      const now = Date.now();
      for (const el of ctx.items) {
        if (shouldSkip && shouldSkip(el)) continue;

        const prev = seen.get(el);
        if (prev && now - prev.at < (prev.settled ? rescan : retry)) continue;

        const meta = ctx.getMeta(el);
        seen.set(el, { at: now, settled: meta.views != null });
        if (handle) handle(el, meta, ctx);
      }
    };
  }

  class TileFeature {
    #flag;

    constructor(flag) {
      this.#flag = flag;
    }

    get enabled() {
      return !window.YTCAL_FEATURES || window.YTCAL_FEATURES[this.#flag] !== false;
    }

    start(ctx) {
      if (!this.enabled) {
        console.log(`[ytcal] ${this.#flag} disabled`);
        return;
      }
      this.scan(ctx);
    }

    onNavigate(ctx) {
      if (this.enabled) this.scan(ctx);
    }

    onMutate(ctx) {
      if (this.enabled) this.scan(ctx);
    }

    // Implemented by subclasses.
    scan() {}
  }

  YTCAL.createTileScanner = createTileScanner;
  YTCAL.TileFeature = TileFeature;
})();
