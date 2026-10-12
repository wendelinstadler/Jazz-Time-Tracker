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

const { DEFAULT_SETTINGS, computeDayStatus, todayKey, resolveLanguage, translate } = globalThis.JTT;

const ALARM_SOON = "jtt-go-home-soon";
const ALARM_NOW = "jtt-go-home-now";
const ALARM_ICON = "jtt-icon";
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
  updateIcon();
}

chrome.runtime.onInstalled.addListener(startIconTimer);
chrome.runtime.onStartup.addListener(startIconTimer);
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
  if (alarm.name !== ALARM_SOON && alarm.name !== ALARM_NOW) return;
  chrome.storage.local.get({ jttAlarmTexts: null, notifyEnabled: true }, (items) => {
    const texts = items.jttAlarmTexts;
    if (!texts || !items.notifyEnabled) return;
    if (alarm.name === ALARM_SOON) showNotification(ALARM_SOON, texts.soonTitle, texts.soonBody);
    else showNotification(ALARM_NOW, texts.nowTitle, texts.nowBody);
  });
});
