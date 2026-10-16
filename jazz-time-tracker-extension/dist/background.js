/*
 * Jazz Time Tracker – background script
 * - Shows browser notifications. The content script decides what and when;
 *   this script keeps the two "go home" alarms and displays the messages.
 * - Draws the toolbar icon: a progress ring with the percentage of today's target.
 */
"use strict";

// Chrome runs this file as a service worker and needs the shared core loaded here;
// Firefox lists core.js in the manifest instead.
if (typeof importScripts === "function" && !globalThis.JTT) importScripts("core.js");

const { DEFAULT_SETTINGS, SETTING_KEYS, computeDayStatus, todayKey, resolveLanguage, translate, readBackup } = globalThis.JTT;

const ALARM_SOON = "jtt-go-home-soon";
const ALARM_NOW = "jtt-go-home-now";
const ALARM_ICON = "jtt-icon";
const ALARM_BREAK = "jtt-break-done";
const ALARM_BACKUP = "jtt-auto-backup";
const ICON = chrome.runtime.getURL("icon128.png");

function showNotification(id, title, message) {
  chrome.notifications.create(id, { type: "basic", iconUrl: ICON, title, message }, () => {
    void chrome.runtime.lastError;
  });
}

function clearAlarms() {
  chrome.alarms.clear(ALARM_SOON);
  chrome.alarms.clear(ALARM_NOW);
}

// -------------------------------------------------------------------- icon

const DEFAULT_ICON = { 128: "icon128.png" };

function makeCanvas(size) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(size, size);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * Draws the toolbar icon: a progress ring with the percentage of today's target in the middle.
 * Green while clocked in, grey while clocked out, orange in overtime (then with a check mark).
 * The white disc keeps it readable on light and dark toolbars.
 */
function drawIcon(size, status) {
  const ctx = makeCanvas(size).getContext("2d");
  const centre = size / 2;
  const line = Math.max(2, size * 0.14);
  const radius = centre - line / 2 - size * 0.02;
  const colour = status.overtime ? "#c2620a" : status.clockedIn ? "#12876c" : "#7a7f87";
  const targetMin = status.target.totalMinutes;
  const ratio = targetMin > 0 ? Math.max(0, status.timeSpent.totalMinutes) / targetMin : 0;

  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(centre, centre, centre - size * 0.02, 0, 2 * Math.PI);
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  ctx.lineWidth = line;
  ctx.beginPath();
  ctx.arc(centre, centre, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = "#d5d9df";
  ctx.stroke();

  if (ratio > 0) {
    ctx.beginPath();
    ctx.arc(centre, centre, radius, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * Math.min(1, ratio));
    ctx.strokeStyle = colour;
    ctx.lineCap = ratio >= 1 ? "butt" : "round";
    ctx.stroke();
  }

  if (ratio >= 1) {
    // Target reached: a check mark instead of a three-digit number that would not fit.
    ctx.beginPath();
    ctx.moveTo(size * 0.32, size * 0.52);
    ctx.lineTo(size * 0.45, size * 0.65);
    ctx.lineTo(size * 0.69, size * 0.38);
    ctx.lineWidth = Math.max(1.5, size * 0.1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = colour;
    ctx.stroke();
  } else {
    ctx.fillStyle = "#1c2430";
    ctx.font = `bold ${Math.round(size * 0.44)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.floor(ratio * 100)), centre, centre + size * 0.03);
  }
  return ctx.getImageData(0, 0, size, size);
}

/** Without stamps today the normal icon is shown. The tooltip carries the exact times. */
function updateIcon() {
  chrome.storage.local.get({ ...DEFAULT_SETTINGS, liveStatus: null }, (items) => {
    const live = items.liveStatus;
    const hasToday = live && live.date === todayKey() && Array.isArray(live.checkpoints) && live.checkpoints.length > 0;
    chrome.action.setBadgeText({ text: "" });
    if (!hasToday) {
      chrome.action.setIcon({ path: DEFAULT_ICON });
      chrome.action.setTitle({ title: "Jazz Time Tracker" });
      return;
    }
    const status = computeDayStatus(items, live.checkpoints, live.absenceMinutes || 0);
    const lang = resolveLanguage(items.language);
    try {
      chrome.action.setIcon({ imageData: { 16: drawIcon(16, status), 32: drawIcon(32, status), 48: drawIcon(48, status) } });
    } catch (err) {
      chrome.action.setIcon({ path: DEFAULT_ICON });
    }
    chrome.action.setTitle({
      title: [
        `${translate(lang, "timeSpent")} ${status.timeSpent.toString()}`,
        `${translate(lang, "timeToGo")} ${status.timeToGo.toString()}`,
        `${translate(lang, "goHome")} ${status.goHomeTime.toString()}`,
      ].join("\n"),
    });
  });
}

function startIconTimer() {
  chrome.alarms.create(ALARM_ICON, { periodInMinutes: 1 });
  chrome.alarms.create(ALARM_BACKUP, { delayInMinutes: 1, periodInMinutes: 360 });
  updateIcon();
}

// ------------------------------------------------------------------ backup

const BACKUP_EVERY_DAYS = 30;

/**
 * Once a month the data is saved as a file to Downloads/Jazz Time Tracker.
 * The first run only notes the date, so installing does not drop a file right away.
 */
function autoBackup() {
  chrome.storage.local.get({ autoBackup: true, jttLastBackup: null, language: "auto" }, (items) => {
    if (!items.autoBackup) return;
    const now = Date.now();
    if (!items.jttLastBackup) {
      chrome.storage.local.set({ jttLastBackup: now });
      return;
    }
    if (now - items.jttLastBackup < BACKUP_EVERY_DAYS * 86400000) return;
    readBackup((json) => {
      // Service workers have no blob URLs; a data URL works for files of this size.
      const url =
        typeof URL.createObjectURL === "function" && typeof Blob === "function" && typeof document !== "undefined"
          ? URL.createObjectURL(new Blob([json], { type: "application/json" }))
          : `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
      chrome.downloads.download(
        { url, filename: `Jazz Time Tracker/jazz-time-tracker-${todayKey()}.json`, conflictAction: "uniquify", saveAs: false },
        (id) => {
          if (chrome.runtime.lastError || id === undefined) return;
          chrome.storage.local.set({ jttLastBackup: now });
          const lang = resolveLanguage(items.language);
          showNotification(ALARM_BACKUP, translate(lang, "autoBackupDoneTitle"), translate(lang, "autoBackupDoneBody"));
        },
      );
    });
  });
}

// -------------------------------------------------------------------- sync

/**
 * Settings and plans are mirrored to chrome.storage.sync, so every browser signed in to the
 * same account gets them. Local storage stays the place everything reads from.
 * jttSyncAt says which side is newer; it is only written here, which also tells our own
 * writes apart from the user's changes.
 */
const SYNC_KEYS = [...SETTING_KEYS.filter((key) => key !== "syncSettings"), "jttPlan"];
let syncTimer = null;

function pushToSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    chrome.storage.local.get({ ...DEFAULT_SETTINGS, jttPlan: null }, (items) => {
      if (items.syncSettings === false) return;
      const now = Date.now();
      const data = { jttSyncAt: now };
      for (const key of SYNC_KEYS) if (items[key] !== null && items[key] !== undefined) data[key] = items[key];
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) return; // sync off or quota: local keeps working
        chrome.storage.local.set({ jttSyncAt: now });
      });
    });
  }, 1500);
}

function pullFromSync() {
  chrome.storage.local.get({ syncSettings: true, jttSyncAt: 0 }, (local) => {
    if (local.syncSettings === false) return;
    chrome.storage.sync.get(null, (remote) => {
      if (chrome.runtime.lastError || !remote || !remote.jttSyncAt || remote.jttSyncAt <= local.jttSyncAt) return;
      const data = { jttSyncAt: remote.jttSyncAt };
      for (const key of SYNC_KEYS) if (key in remote) data[key] = remote[key];
      chrome.storage.local.set(data);
    });
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    if (changes.jttSyncAt) pullFromSync();
    return;
  }
  if (area !== "local" || changes.jttSyncAt) return; // our own write
  if (SYNC_KEYS.some((key) => key in changes) || changes.syncSettings) pushToSync();
});

chrome.runtime.onInstalled.addListener(startIconTimer);
chrome.runtime.onStartup.addListener(startIconTimer);
chrome.runtime.onStartup.addListener(pullFromSync);
chrome.runtime.onInstalled.addListener(pullFromSync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.liveStatus || changes.dailyHours || changes.language)) updateIcon();
});

// ----------------------------------------------------------- notifications

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return;

  if (message.type === "jtt-schedule") {
    clearAlarms();
    const now = Date.now();
    const soonAt = message.goHomeAt - message.leadMinutes * 60000;
    chrome.storage.local.set({ jttAlarmTexts: message.texts }, () => {
      if (soonAt > now) chrome.alarms.create(ALARM_SOON, { when: soonAt });
      if (message.goHomeAt > now) chrome.alarms.create(ALARM_NOW, { when: message.goHomeAt });
    });
  } else if (message.type === "jtt-clear") {
    clearAlarms();
  } else if (message.type === "jtt-break") {
    chrome.alarms.clear(ALARM_BREAK);
    chrome.storage.local.set({ jttBreakTexts: message.texts }, () => {
      if (message.at > Date.now()) chrome.alarms.create(ALARM_BREAK, { when: message.at });
    });
  } else if (message.type === "jtt-break-clear") {
    chrome.alarms.clear(ALARM_BREAK);
  } else if (message.type === "jtt-notify") {
    showNotification(message.id, message.title, message.message);
  }
  sendResponse({ ok: true });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_ICON) {
    updateIcon();
    return;
  }
  if (alarm.name === ALARM_BACKUP) {
    autoBackup();
    return;
  }
  if (alarm.name === ALARM_BREAK) {
    chrome.storage.local.get({ jttBreakTexts: null, notifyEnabled: true }, (items) => {
      if (items.jttBreakTexts && items.notifyEnabled) {
        showNotification(ALARM_BREAK, items.jttBreakTexts.title, items.jttBreakTexts.body);
      }
    });
    return;
  }
  if (alarm.name !== ALARM_SOON && alarm.name !== ALARM_NOW) return;
  chrome.storage.local.get({ jttAlarmTexts: null, notifyEnabled: true }, (items) => {
    const texts = items.jttAlarmTexts;
    if (!texts || !items.notifyEnabled) return;
    if (alarm.name === ALARM_SOON) showNotification(ALARM_SOON, texts.soonTitle, texts.soonBody);
    else showNotification(ALARM_NOW, texts.nowTitle, texts.nowBody);
  });
});

// ---------------------------------------------------------------- shortcut

/** Alt+J (Option+J on Mac): switch to the Jazz stamp page, or open it. */
const JAZZ_FALLBACK_URL = "https://jazz.coop.ch/mobile/";

chrome.commands.onCommand.addListener((command) => {
  if (command !== "open-jazz") return;
  chrome.storage.local.get({ jttStampUrl: JAZZ_FALLBACK_URL }, (items) => {
    const patterns = chrome.runtime.getManifest().host_permissions; // the Jazz pages this extension may see
    chrome.tabs.query({ url: patterns }, (tabs) => {
      const tab = (tabs || []).find((t) => (t.url || "").includes("stempel")) || (tabs || [])[0];
      if (tab) {
        chrome.tabs.update(tab.id, { active: true });
        chrome.windows.update(tab.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: items.jttStampUrl });
      }
    });
  });
});
