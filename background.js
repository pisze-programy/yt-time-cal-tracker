class CalendarSync {
  #TAG = "[yt-cal]";
  #PENDING_KEY = "ytcal_pending_events";
  #SENT_IDS_KEY = "ytcal_sent_event_ids";
  #MAX_SENT_IDS = 100;
  #MAX_QUEUE_AGE_MS = 7 * 24 * 3600 * 1000;

  #cachedToken = null;
  #tokenExpiry = 0;
  #tokenPromise = null;
  #inFlightIds = new Set();
  #flushing = null;

  constructor() {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg && msg.action === "LOG_YOUTUBE_EVENT") {
        console.log(this.#TAG, "received event", msg.title, msg.durationSec + "s");
        // Returning the Promise keeps the non-persistent event page alive until
        // the event is sent or durably queued in storage.local.
        return this.#handleLogEvent(msg).catch((err) => {
          console.error(this.#TAG, "handleLogEvent failed", err);
          return { ok: false };
        });
      }
    });

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.ytcal_google_config) {
        this.#cachedToken = null;
        this.#tokenExpiry = 0;
        this.#flushQueue();
      }
    });

    if (typeof addEventListener === "function") {
      addEventListener("online", () => this.#flushQueue());
    }

    // Retry any events left in the outbox from an earlier offline period or restart.
    this.#flushQueue();
  }

  async #handleLogEvent(msg) {
    const startMs = Date.parse(msg.startedAt);
    if (!Number.isFinite(startMs) || !(msg.durationSec > 0)) {
      return { ok: true, skipped: true };
    }

    const eventId = msg.eventId || `${msg.url}:${msg.startedAt}`;
    if (this.#inFlightIds.has(eventId) || (await this.#wasAlreadySent(eventId))) {
      console.log(this.#TAG, "duplicate event skipped", eventId);
      return { ok: true, deduped: true };
    }

    const item = {
      eventId,
      title: msg.title || "YouTube",
      url: msg.url || "",
      channel: msg.channel || "",
      startedAt: new Date(startMs).toISOString(),
      durationSec: Math.round(msg.durationSec),
      queuedAt: Date.now(),
    };

    await this.#enqueue(item);
    await this.#flushQueue();
    return { ok: true };
  }

  async #readPending() {
    try {
      const res = await browser.storage.local.get(this.#PENDING_KEY);
      return Array.isArray(res[this.#PENDING_KEY]) ? res[this.#PENDING_KEY] : [];
    } catch (_) {
      return [];
    }
  }

  async #writePending(list) {
    try {
      await browser.storage.local.set({ [this.#PENDING_KEY]: list });
    } catch (_) {}
  }

  async #enqueue(item) {
    const list = await this.#readPending();
    if (list.some((x) => x && x.eventId === item.eventId)) return;
    list.push(item);
    await this.#writePending(list);
  }

  async #wasAlreadySent(eventId) {
    try {
      const res = await browser.storage.local.get(this.#SENT_IDS_KEY);
      const ids = Array.isArray(res[this.#SENT_IDS_KEY]) ? res[this.#SENT_IDS_KEY] : [];
      return ids.includes(eventId);
    } catch (_) {
      return false;
    }
  }

  async #markSent(eventId) {
    try {
      const res = await browser.storage.local.get(this.#SENT_IDS_KEY);
      const ids = Array.isArray(res[this.#SENT_IDS_KEY]) ? res[this.#SENT_IDS_KEY] : [];
      if (!ids.includes(eventId)) {
        ids.push(eventId);
        if (ids.length > this.#MAX_SENT_IDS) ids.splice(0, ids.length - this.#MAX_SENT_IDS);
        await browser.storage.local.set({ [this.#SENT_IDS_KEY]: ids });
      }
    } catch (_) {}
  }

  #flushQueue() {
    if (this.#flushing) return this.#flushing;
    this.#flushing = this.#doFlushQueue().finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  async #doFlushQueue() {
    const list = await this.#readPending();
    if (!list.length) return;

    const cfg = await this.#getConfig();
    if (!cfg) {
      console.warn(
        this.#TAG,
        "Google Calendar not configured — open extension Options to set credentials"
      );
      return;
    }

    const now = Date.now();
    const remaining = [];
    for (const item of list) {
      if (!item || !item.eventId) continue;
      if (now - (item.queuedAt || now) > this.#MAX_QUEUE_AGE_MS) continue;
      if (this.#inFlightIds.has(item.eventId) || (await this.#wasAlreadySent(item.eventId))) {
        continue;
      }

      this.#inFlightIds.add(item.eventId);
      let outcome = "retry";
      try {
        outcome = await this.#createCalendarEvent(item, cfg);
      } catch (err) {
        console.error(this.#TAG, "createCalendarEvent failed (will retry)", err);
        outcome = "retry";
      } finally {
        this.#inFlightIds.delete(item.eventId);
      }

      if (outcome === "sent") {
        await this.#markSent(item.eventId);
      } else if (outcome === "retry") {
        remaining.push(item);
      }
      // outcome === "drop": permanent 4xx error — do not re-queue.
    }

    // Preserve any new items appended while we were flushing.
    const latest = await this.#readPending();
    const processedIds = new Set(list.map((x) => x && x.eventId));
    const newlyAdded = latest.filter((x) => x && !processedIds.has(x.eventId));
    await this.#writePending([...remaining, ...newlyAdded]);
  }

  async #getConfig() {
    const { ytcal_google_config: stored } = await browser.storage.local.get("ytcal_google_config");
    const cfg = stored || (typeof GOOGLE_CONFIG !== "undefined" ? GOOGLE_CONFIG : null);
    if (!cfg || !cfg.client_email || !cfg.private_key || !cfg.calendar_id) {
      return null;
    }
    return cfg;
  }

  async #createCalendarEvent({ title, url, channel, startedAt, durationSec }, cfg) {
    const start = new Date(startedAt);
    start.setSeconds(0, 0);
    const durationMin = Math.max(1, Math.round(durationSec / 60));
    const end = new Date(start.getTime() + durationMin * 60000);

    console.log(this.#TAG, "creating event", title, start.toISOString(), "->", end.toISOString());

    const payload = JSON.stringify({
      summary: `YT - ${title}`,
      description: `Channel: ${channel || "Unknown"}, Watched: ${durationMin} min, URL: ${url}`,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      reminders: { useDefault: false, overrides: [] },
    });

    const endpoint = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      cfg.calendar_id
    )}/events`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.#getToken(cfg);
      if (!token) {
        console.error(this.#TAG, "no token – keeping in queue for retry");
        return "retry";
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: payload,
      });

      if (res.ok) {
        const event = await res.json();
        console.log(this.#TAG, "event created", event.htmlLink);
        return "sent";
      }

      if (res.status === 401 && attempt === 0) {
        console.warn(this.#TAG, "401 Unauthorized — refreshing token and retrying");
        this.#cachedToken = null;
        this.#tokenExpiry = 0;
        continue;
      }

      const text = await res.text();
      console.error(this.#TAG, "Calendar API error", res.status, text);
      if (res.status === 429 || res.status >= 500) return "retry";
      return "drop";
    }

    return "retry";
  }

  async #getToken(cfg) {
    const now = Math.floor(Date.now() / 1000);
    if (this.#cachedToken && this.#tokenExpiry - now > 300) {
      console.log(this.#TAG, "using cached token, expires in", this.#tokenExpiry - now, "s");
      return this.#cachedToken;
    }
    if (this.#tokenPromise) return this.#tokenPromise;

    this.#tokenPromise = this.#fetchToken(cfg, now).finally(() => {
      this.#tokenPromise = null;
    });
    return this.#tokenPromise;
  }

  async #fetchToken(cfg, now) {
    console.log(this.#TAG, "fetching new JWT token");

    const header = this.#b64url(
      new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    );
    const claim = this.#b64url(
      new TextEncoder().encode(
        JSON.stringify({
          iss: cfg.client_email,
          scope: "https://www.googleapis.com/auth/calendar.events",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        })
      )
    );

    let key;
    try {
      key = await this.#importPem(cfg.private_key);
    } catch (err) {
      console.error(this.#TAG, "importPem failed", err);
      return null;
    }

    const sig = await crypto.subtle.sign(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      new TextEncoder().encode(`${header}.${claim}`)
    );

    const jwt = `${header}.${claim}.${this.#b64url(new Uint8Array(sig))}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    const data = await res.json();
    console.log(this.#TAG, "token response", res.status, data.error ?? "ok");

    if (!data.access_token) return null;

    this.#cachedToken = data.access_token;
    this.#tokenExpiry = now + (data.expires_in ?? 3600);
    return this.#cachedToken;
  }

  #b64url(bytes) {
    return btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  async #importPem(pem) {
    const der = Uint8Array.from(
      atob(
        pem
          .replace(/-----BEGIN PRIVATE KEY-----/, "")
          .replace(/-----END PRIVATE KEY-----/, "")
          .replace(/\s+/g, "")
      ),
      (c) => c.charCodeAt(0)
    );
    return crypto.subtle.importKey(
      "pkcs8",
      der.buffer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
}

new CalendarSync();
