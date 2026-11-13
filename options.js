(function () {
  "use strict";

  const STORAGE_KEY = "ytcal_google_config";

  const elFile = document.getElementById("sa-file");
  const elEmail = document.getElementById("client-email");
  const elKey = document.getElementById("private-key");
  const elCal = document.getElementById("calendar-id");
  const elSave = document.getElementById("save");
  const elClear = document.getElementById("clear");
  const elStatus = document.getElementById("status");

  function setStatus(msg, isError) {
    elStatus.textContent = msg;
    elStatus.className = isError ? "err" : "ok";
  }

  async function load() {
    const { [STORAGE_KEY]: cfg } = await browser.storage.local.get(STORAGE_KEY);
    if (!cfg) return;
    elEmail.value = cfg.client_email || "";
    elKey.value = cfg.private_key || "";
    elCal.value = cfg.calendar_id || "";
  }

  elFile.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (json.client_email) elEmail.value = json.client_email;
      if (json.private_key) elKey.value = json.private_key;
      setStatus("Imported JSON — enter Calendar ID and click Save.", false);
    } catch {
      setStatus("Invalid JSON file.", true);
    }
  });

  elSave.addEventListener("click", async () => {
    const client_email = elEmail.value.trim();
    const private_key = elKey.value.trim().replace(/\\n/g, "\n");
    const calendar_id = elCal.value.trim();

    if (!client_email || !private_key || !calendar_id) {
      setStatus("All three fields are required.", true);
      return;
    }

    await browser.storage.local.set({
      [STORAGE_KEY]: { client_email, private_key, calendar_id },
    });
    setStatus("Saved.", false);
  });

  elClear.addEventListener("click", async () => {
    await browser.storage.local.remove(STORAGE_KEY);
    elEmail.value = "";
    elKey.value = "";
    elCal.value = "";
    setStatus("Cleared.", false);
  });

  load();
})();
