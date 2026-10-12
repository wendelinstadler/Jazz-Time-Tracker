/*
 * Jazz Time Tracker – popup
 * Live status of today plus the settings.
 */
(() => {
  "use strict";

  const {
    DAYS,
    SettingsManager,
    ComplianceRules,
    computeDayStatus,
    mustClockOut,
    timeBalanceWithToday,
    formatSigned,
    todayKey,
    resolveLanguage,
    translate,
  } = globalThis.JTT;

  const RING_LENGTH = 251.33; // circumference of the r=40 progress ring
  const $ = (id) => document.getElementById(id);

  const manager = new SettingsManager();
  let saved = null; // settings as stored
  let lang = "en";
  let live = null; // today's stamps, written by the content script
  let statusTimer = null;

  const t = (key, params) => translate(lang, key, params);

  function showStatus(text, type) {
    const el = $("statusMessage");
    el.textContent = text;
    el.className = `status-message show ${type}`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove("show"), type === "error" ? 5000 : 1800);
  }

  // --------------------------------------------------------------- language

  function applyLanguage() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });
    document.querySelectorAll(".segmented button").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
    });
    document.querySelectorAll("#notifyLeadMinutes option").forEach((opt) => {
      opt.textContent = t("minutesShort", { n: opt.value });
    });
    document.querySelectorAll(".day").forEach((row) => {
      const name = t(row.dataset.day);
      row.querySelector(".day-label").textContent = name;
      row.querySelector(".work-hours").setAttribute("aria-label", `${name}, ${t("hours")}`);
      row.querySelector(".work-minutes").setAttribute("aria-label", `${name}, ${t("minutes")}`);
    });

    renderLive();
  }

  // ------------------------------------------------------------ live status

  function renderLive() {
    const hasToday = live && live.date === todayKey() && Array.isArray(live.checkpoints) && saved;
    $("liveBody").hidden = !hasToday;
    $("liveMeta").hidden = !hasToday;
    $("liveEmpty").hidden = Boolean(hasToday);
    if (!hasToday) {
      $("liveBalances").hidden = true;
      delete $("liveCard").dataset.over;
      return;
    }

    const status = computeDayStatus(saved, live.checkpoints, live.absenceMinutes || 0);
    const over = Boolean(status.overtime);
    $("liveCard").dataset.over = String(over);

    const percent = Math.round(status.progress * 100);
    $("livePercent").textContent = String(percent);
    $("ringFill").style.strokeDashoffset = String(RING_LENGTH * (1 - status.progress));

    // Only two states: clocked in or clocked out.
    const chip = $("liveChip");
    chip.dataset.state = status.clockedIn ? "in" : "out";
    chip.textContent = status.clockedIn ? t("clockedIn") : t("clockedOut");

    let clockOut = false;
    if (status.clockedIn && saved.showViolations) {
      const findings = new ComplianceRules(saved.isApprentice, false, true).checkAll(live.checkpoints);
      clockOut = mustClockOut(findings, true);
    }
    $("liveClockOut").hidden = !clockOut;
    $("liveClockOut").textContent = t("clockOutNow");

    $("liveSpent").textContent = status.timeSpent.toString();
    $("liveToGoLabel").textContent = t("timeToGo");
    $("liveToGo").textContent = status.timeToGo.toString(); // negative once the target is passed
    $("liveOverWrap").dataset.over = String(over);
    $("liveOver").textContent = over ? `+${status.overtime.toString()}` : "0:00";
    $("liveHome").textContent = status.goHomeTime.toString();
    $("liveBreak").textContent = status.breaks.toString();
    renderBalances(status);

    const updated = new Date(live.updatedAt || Date.now());
    const time = `${updated.getHours()}:${String(updated.getMinutes()).padStart(2, "0")}`;
    $("liveUpdated").textContent = t("updatedAt", { time });
  }

  /** Balances the content script read from the Jazz page, plus the time balance including today. */
  function renderBalances(status) {
    const balances = live.balances || null;
    const shortDate = (date) => date.replace(/^(\d{1,2}\.\d{1,2}\.)\d{2,4}$/, "$1");
    const set = (rowId, valueId, value) => {
      $(rowId).hidden = value === null;
      if (value === null) return false;
      $(valueId).textContent = value;
      $(valueId).dataset.negative = String(value.startsWith("\u2212"));
      return true;
    };
    const time = balances && balances.time;
    const vacation = balances && balances.vacation;
    const withToday = timeBalanceWithToday(balances, status);
    const any = [
      set("balTimeRow", "balTime", time ? `${time.value} ${t("unitHours")}` : null),
      set("balTodayRow", "balToday", withToday !== null ? `${formatSigned(withToday)} ${t("unitHours")}` : null),
      set("balVacRow", "balVac", vacation ? `${vacation.value} ${t("unitDays")}` : null),
    ].some(Boolean);
    $("balTimeSub").textContent = time && time.asOf ? t("asOf", { date: shortDate(time.asOf) }) : "";
    $("balVacSub").textContent = vacation && vacation.asOf ? t("asOf", { date: shortDate(vacation.asOf) }) : "";
    $("liveBalances").hidden = !any;
  }

  function loadLive() {
    try {
      chrome.storage.local.get({ liveStatus: null }, (items) => {
        live = items.liveStatus;
        renderLive();
      });
    } catch (err) {
      renderLive();
    }
  }

  // --------------------------------------------------------------- settings

  function buildDayRows() {
    const container = $("days");
    for (const day of DAYS) {
      const row = document.createElement("div");
      row.className = "day";
      row.dataset.day = day;
      row.innerHTML = `
        <div class="day-label"></div>
        <input class="work-hours" data-day="${day}" type="number" min="0" max="12" value="8"/>
        <span class="sep" aria-hidden="true">:</span>
        <input class="work-minutes" data-day="${day}" type="number" min="0" max="59" value="12"/>`;
      container.appendChild(row);
    }
  }

  function fillForm(settings) {
    $("isApprentice").checked = settings.isApprentice;
    $("showWarnings").checked = settings.showWarnings;
    $("showViolations").checked = settings.showViolations;
    $("notifyEnabled").checked = settings.notifyEnabled;
    $("notifyLeadMinutes").value = String(settings.notifyLeadMinutes);
    for (const day of DAYS) {
      const cfg = settings.dailyHours[day] || { hours: 0, minutes: 0 };
      document.querySelector(`.work-hours[data-day="${day}"]`).value = cfg.hours;
      document.querySelector(`.work-minutes[data-day="${day}"]`).value = cfg.minutes;
    }
    syncLeadRow();
  }

  function syncLeadRow() {
    const enabled = $("notifyEnabled").checked;
    $("notifyLeadRow").classList.toggle("is-disabled", !enabled);
    $("notifyLeadMinutes").disabled = !enabled;
  }

  /** Reads the form. Returns null (and shows why) if a value is out of range. */
  function readForm() {
    const dailyHours = {};
    for (const day of DAYS) {
      const hours = parseInt(document.querySelector(`.work-hours[data-day="${day}"]`).value) || 0;
      const minutes = parseInt(document.querySelector(`.work-minutes[data-day="${day}"]`).value) || 0;
      if (hours < 0 || hours > 12) {
        showStatus(t("errHours", { day: t(day) }), "error");
        return null;
      }
      if (minutes < 0 || minutes > 59) {
        showStatus(t("errMinutes", { day: t(day) }), "error");
        return null;
      }
      dailyHours[day] = { hours, minutes };
    }
    return {
      isApprentice: $("isApprentice").checked,
      showWarnings: $("showWarnings").checked,
      showViolations: $("showViolations").checked,
      notifyEnabled: $("notifyEnabled").checked,
      notifyLeadMinutes: parseInt($("notifyLeadMinutes").value) || 10,
      dailyHours,
    };
  }

  function sameSettings(a, b) {
    return (
      a.isApprentice === b.isApprentice &&
      a.showWarnings === b.showWarnings &&
      a.showViolations === b.showViolations &&
      a.notifyEnabled === b.notifyEnabled &&
      Number(a.notifyLeadMinutes) === Number(b.notifyLeadMinutes) &&
      DAYS.every((day) => {
        const x = a.dailyHours[day] || { hours: 0, minutes: 0 };
        const y = b.dailyHours[day] || { hours: 0, minutes: 0 };
        return x.hours === y.hours && x.minutes === y.minutes;
      })
    );
  }

  /** Saves the form as soon as something changes. Invalid numbers are reported and not saved. */
  async function autoSave() {
    try {
      const next = readForm();
      if (!next) return;
      const current = await manager.loadSettings();
      if (sameSettings(current, next)) return;
      await manager.saveSettings(next);
      saved = { ...current, ...next };
      renderLive();
      showStatus(t("autoSaved"), "success");
    } catch (err) {
      console.error("Error saving settings:", err);
      showStatus(t("saveError"), "error");
    }
  }

  let saveTimer = null;
  function scheduleSave(delay) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autoSave, delay);
  }

  // ------------------------------------------------------------------- boot

  document.addEventListener("DOMContentLoaded", async () => {
    buildDayRows();

    try {
      const manifest = chrome.runtime.getManifest();
      $("extVersion").textContent = manifest.version || "-";
    } catch (err) {
      console.warn("Could not read extension manifest:", err);
    }

    try {
      saved = await manager.loadSettings();
      lang = resolveLanguage(saved.language);
      fillForm(saved);
    } catch (err) {
      console.error("Error initializing popup:", err);
      lang = resolveLanguage("auto");
      applyLanguage();
      showStatus(t("loadError"), "error");
      return;
    }
    applyLanguage();

    // The language switch applies and saves right away.
    document.querySelectorAll(".segmented button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        lang = btn.dataset.lang;
        applyLanguage();
        try {
          await manager.saveSettings({ language: lang });
          saved.language = lang;
        } catch (err) {
          console.error("Error saving language:", err);
        }
      });
    });

    $("notifyEnabled").addEventListener("change", syncLeadRow);
    // Switches and the select save at once; typed numbers wait a moment so half-typed values are not saved.
    document.querySelectorAll('input[type="checkbox"], select').forEach((el) => {
      el.addEventListener("change", () => scheduleSave(0));
    });
    document.querySelectorAll('input[type="number"]').forEach((el) => {
      el.addEventListener("input", () => scheduleSave(600));
      el.addEventListener("change", () => scheduleSave(0));
    });

    loadLive();
    setInterval(renderLive, 1000);
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.liveStatus) {
          live = changes.liveStatus.newValue;
          renderLive();
        }
      });
    } catch (err) {
      /* no live updates without storage events */
    }
  });
})();
