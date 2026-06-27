class CalendarSync {
  #TAG = "[yt-cal]";

  #cachedToken = null;
  #tokenExpiry = 0;

  constructor() {
    browser.runtime.onMessage.addListener((msg) => {
      if (msg.action === "LOG_YOUTUBE_EVENT") {
        console.log(this.#TAG, "received event", msg.title, msg.durationSec + "s");
        this.#createCalendarEvent(msg).catch((err) =>
          console.error(this.#TAG, "createCalendarEvent failed", err)
        );
      }
    });
  }

  async #createCalendarEvent({ title, url, startedAt, durationSec }) {
    const start = new Date(startedAt);
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + durationSec * 1000);
    end.setSeconds(0, 0);

    console.log(this.#TAG, "creating event", title, start.toISOString(), "->", end.toISOString());

    const token = await this.#getToken();
    if (!token) {
      console.error(this.#TAG, "no token – aborting");
      return;
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CONFIG.calendar_id)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: `YT - ${title} ${channel}`,
          description: `${url}`,
          start: { dateTime: start.toISOString() },
          end: { dateTime: end.toISOString() },
          reminders: { useDefault: false, overrides: [] },
        }),
      }
    );

    if (res.ok) {
      const event = await res.json();
      console.log(this.#TAG, "event created", event.htmlLink);
    } else {
      const text = await res.text();
      console.error(this.#TAG, "Calendar API error", res.status, text);
    }
  }

  async #getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.#cachedToken && this.#tokenExpiry - now > 300) {
      console.log(this.#TAG, "using cached token, expires in", this.#tokenExpiry - now, "s");
      return this.#cachedToken;
    }

    console.log(this.#TAG, "fetching new JWT token");

    const header = this.#b64url(
      new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    );
    const claim = this.#b64url(
      new TextEncoder().encode(
        JSON.stringify({
          iss: GOOGLE_CONFIG.client_email,
          scope: "https://www.googleapis.com/auth/calendar.events",
          aud: "https://oauth2.googleapis.com/token",
          iat: now,
          exp: now + 3600,
        })
      )
    );

    let key;
    try {
      key = await this.#importPem(GOOGLE_CONFIG.private_key);
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
