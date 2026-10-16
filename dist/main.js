/*
 * Jazz Time Tracker – content script
 * Runs on the Jazz time stamp page: reads the stamps, shows the day panel
 * and the rule alerts, shares the live data with the popup and schedules
 * notifications through the background script.
 */
(() => {
  "use strict";

  const {
    SettingsManager,
    Time,
    ComplianceRules,
    computeDayStatus,
    mustClockOut,
    parseSignedTime,
    formatSigned,
    runningBreak,
    leaveAtDifference,
    timeBalanceWithToday,
    plannedGoHome,
    goalPerDay,
    isSchoolToday,
    schoolDays,
    breakWindow,
    goalToday,
    describeGoalToday,
    DAYS,
    todayKey,
    resolveLanguage,
    translate,
  } = globalThis.JTT;

  const ICONS = {
    violation:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>',
    warning:
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="m8.93 6.588-2.29.287-.082.38.45.083c.294.07.352.176.288.469l-.738 3.468c-.194.897.105 1.319.808 1.319.545 0 1.178-.252 1.465-.598l.088-.416c-.2.176-.492.246-.686.246-.275 0-.375-.193-.304-.533zM9 4.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0"/></svg>',
  };

  const STYLES = `
    .jtt-panel, .jtt-alerts {
      --jtt-bg: #f3f3f3;
      --jtt-text: inherit;
      --jtt-muted: #6b6b6b;
      --jtt-track: #dcdcdc;
      --jtt-accent: #84b2a6;
      --jtt-accent-text: #1f6f58;
      --jtt-over: #b45309;
      --jtt-absence: #5b8fc7;
      --jtt-field: #ffffff;
      --jtt-frame: rgba(0, 0, 0, 0.35);
      --jtt-normal: #6f747b;
      --jtt-text-strong: #1c2430;
      --jtt-bg-raised: #ffffff;
      --jtt-warn-bg: #fdf3dc;
      --jtt-warn-bar: #d99a1c;
      --jtt-warn-text: #7a4a00;
      --jtt-viol-bg: #fbe5e5;
      --jtt-viol-bar: #c62828;
      --jtt-viol-text: #9b1c1c;
      box-sizing: border-box;
    }
    .jtt-panel[data-jtt-theme="dark"], .jtt-alerts[data-jtt-theme="dark"] {
      --jtt-bg: #25282d;
      --jtt-muted: #a3a8b0;
      --jtt-track: #3a3e46;
      --jtt-accent: #84b2a6;
      --jtt-accent-text: #9fd0c2;
      --jtt-over: #fbbf24;
      --jtt-absence: #7fb0e6;
      --jtt-field: #1b1d21;
      --jtt-frame: rgba(255, 255, 255, 0.3);
      --jtt-normal: #9aa0a8;
      --jtt-text-strong: #eceef2;
      --jtt-bg-raised: #3a3e46;
      --jtt-warn-bg: #3a2f14;
      --jtt-warn-bar: #d99a1c;
      --jtt-warn-text: #fcd67a;
      --jtt-viol-bg: #3d1c1c;
      --jtt-viol-bar: #ef5350;
      --jtt-viol-text: #fca5a5;
    }
    .jtt-panel *, .jtt-alerts * { box-sizing: border-box; }
    /* Flat block, same shape as the "Heute" block of Jazz. */
    .jtt-panel {
      margin: 0 -15px 15px;
      padding: 18px 24px 16px;
      background: var(--jtt-bg);
      text-align: center;
    }
    .jtt-panel { position: relative; border: 1px solid var(--jtt-frame); }
    .jtt-tools {
      position: absolute;
      top: 12px;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .jtt-tools-left { left: 14px; }
    .jtt-tools-right { right: 14px; }
    .jtt-btn {
      all: unset;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 28px;
      padding: 0 6px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bolder;
      line-height: 1;
      color: var(--jtt-muted);
      cursor: pointer;
    }
    .jtt-btn:hover { background: var(--jtt-track); }
    .jtt-btn:focus-visible { outline: 2px solid var(--jtt-accent); outline-offset: 1px; }
    .jtt-btn[aria-pressed="true"] { background: var(--jtt-accent); color: #ffffff; }
    .jtt-btn svg { display: block; }
    .jtt-btn[data-active="true"]::after {
      content: "";
      position: absolute;
      top: 4px;
      right: 4px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--jtt-accent);
    }
    .jtt-btn { position: relative; }
    .jtt-menu {
      display: none;
      position: absolute;
      top: 44px;
      right: 14px;
      z-index: 5;
      min-width: 200px;
      padding: 4px;
      border-radius: 8px;
      border: 1px solid var(--jtt-frame);
      background: var(--jtt-bg-raised);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
      text-align: left;
    }
    .jtt-menu[data-open="true"] { display: block; }
    .jtt-menu .jtt-btn {
      display: flex;
      width: 100%;
      height: 34px;
      justify-content: flex-start;
      gap: 10px;
      padding: 0 10px;
      font-size: 13px;
      font-weight: normal;
      color: var(--jtt-text-strong);
    }
    .jtt-menu .jtt-btn[aria-checked="true"] { color: var(--jtt-accent-text); font-weight: bolder; }
    .jtt-menu .jtt-btn[aria-checked="true"]::after {
      content: "\\2713";
      position: static;
      width: auto;
      height: auto;
      margin-left: auto;
      background: none;
      color: var(--jtt-accent-text);
    }
    .jtt-lang { gap: 0; border: 1px solid var(--jtt-track); border-radius: 5px; overflow: hidden; }
    .jtt-lang .jtt-btn { border-radius: 0; min-width: 30px; height: 26px; }
    .jtt-whatif[hidden] { display: none; }
    .jtt-title {
      font-size: 14px;
      font-weight: bolder;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .jtt-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
      font-size: 13px;
      color: var(--jtt-muted);
    }
    .jtt-chip::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
    }
    .jtt-chip[data-state="in"] { color: var(--jtt-accent-text); }
    .jtt-clockout {
      margin-top: 10px;
      font-size: 22px;
      font-weight: bolder;
      letter-spacing: 0.03em;
      color: var(--jtt-viol-bar);
    }
    .jtt-clockout[hidden] { display: none; }
    .jtt-stats { margin: 10px 0 14px; }
    .jtt-stat {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 6px;
      padding: 7px 0;
    }
    .jtt-value {
      flex: 1;
      text-align: right;
      font-size: 30px;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .jtt-label { flex: 1; text-align: left; font-size: 14px; }
    .jtt-bar {
      display: flex;
      height: 6px;
      border-radius: 3px;
      background: var(--jtt-track);
      overflow: hidden;
    }
    .jtt-fill {
      height: 100%;
      width: 0;
      background: var(--jtt-accent);
      transition: width 0.6s ease;
    }
    .jtt-fill-absence { background: var(--jtt-absence); }
    .jtt-fill-over { background: var(--jtt-over); }
    .jtt-meta [hidden] { display: none; }
    .jtt-meta-absence::before {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 5px;
      border-radius: 2px;
      background: var(--jtt-absence);
    }
    .jtt-meta-over[data-over="true"] strong { color: var(--jtt-over); }
    .jtt-meta {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 2px 12px;
      margin-top: 8px;
      font-size: 13px;
      color: var(--jtt-muted);
      font-variant-numeric: tabular-nums;
    }
    .jtt-meta strong { font-weight: bolder; }
    .jtt-breakwin { margin-top: 10px; font-size: 13px; color: var(--jtt-accent-text); font-variant-numeric: tabular-nums; }
    .jtt-breakwin[hidden] { display: none; }
    .jtt-goalline { margin-top: 6px; font-size: 13px; font-variant-numeric: tabular-nums; }
    .jtt-goalline[hidden] { display: none; }
    .jtt-goalline[data-kind="todo"] { color: var(--jtt-viol-text); font-weight: bolder; }
    .jtt-goalline[data-kind="ok"] { color: var(--jtt-accent-text); }
    .jtt-goalline[data-kind="muted"] { color: var(--jtt-muted); }
    .jtt-panel[data-school="true"] .jtt-goalline { display: none; }
    .jtt-panel[data-school="true"] .jtt-breakwin { display: none; }
    .jtt-school { display: none; margin: 14px 0 4px; }
    .jtt-school-line { font-size: 22px; }
    .jtt-school-note { margin-top: 4px; font-size: 13px; color: var(--jtt-muted); }
    .jtt-panel[data-school="true"] .jtt-school { display: block; }
    .jtt-panel[data-school="true"] .jtt-chip-wrap,
    .jtt-panel[data-school="true"] .jtt-stats,
    .jtt-panel[data-school="true"] .jtt-bar,
    .jtt-panel[data-school="true"] .jtt-meta,
    .jtt-panel[data-school="true"] .jtt-ok { display: none; }
    .jtt-day[data-school="true"] .jtt-day-track {
      background: repeating-linear-gradient(135deg, var(--jtt-track) 0 6px, transparent 6px 12px);
    }
    .jtt-day[data-school="true"] .jtt-day-value { color: var(--jtt-muted); }
    .jtt-history-chart svg { display: block; overflow: visible; }
    .jtt-day-chart { position: relative; }
    .jtt-day-chart svg { display: block; overflow: visible; }
    .jtt-d-grid { stroke: var(--jtt-track); stroke-width: 1; }
    .jtt-d-target { stroke: var(--jtt-muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.7; }
    .jtt-d-normal { fill: none; stroke: var(--jtt-normal); stroke-width: 2; stroke-dasharray: 5 4; stroke-linejoin: round; }
    .jtt-d-today { fill: none; stroke: var(--jtt-accent-text); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
    .jtt-d-dot { fill: var(--jtt-accent-text); stroke: var(--jtt-bg); stroke-width: 2; }
    .jtt-d-cross { stroke: var(--jtt-muted); stroke-width: 1; }
    .jtt-d-hit { cursor: crosshair; }
    .jtt-d-tip {
      position: absolute;
      top: -6px;
      left: 50%;
      transform: translateX(-50%);
      padding: 3px 8px;
      border-radius: 4px;
      background: var(--jtt-text-strong);
      color: var(--jtt-bg);
      font-size: 12px;
      white-space: nowrap;
      pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    .jtt-d-tip[hidden] { display: none; }
    .jtt-day-legend { display: flex; justify-content: center; gap: 18px; margin-top: 4px; font-size: 12px; color: var(--jtt-muted); }
    .jtt-leg::before { content: ""; display: inline-block; width: 18px; height: 0; margin-right: 6px; vertical-align: middle; border-top: 2.5px solid var(--jtt-accent-text); }
    .jtt-leg-normal::before { border-top: 2px dashed var(--jtt-normal); }
    .jtt-history-gap { height: 22px; }
    .jtt-help {
      margin: 14px 0 6px;
      padding: 12px 14px;
      border-radius: 6px;
      background: var(--jtt-bg-raised);
      text-align: left;
      font-size: 13px;
      line-height: 1.4;
    }
    .jtt-help[hidden] { display: none; }
    .jtt-help-list { margin: 0; }
    .jtt-help-list dt { margin-top: 8px; font-weight: bolder; }
    .jtt-help-list dd { margin: 1px 0 0; color: var(--jtt-muted); }
    .jtt-toggle { display: inline-flex; align-items: center; gap: 8px; margin-bottom: 12px; font-size: 13px; cursor: pointer; }
    .jtt-toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .jtt-toggle-track {
      position: relative;
      width: 34px;
      height: 20px;
      border-radius: 999px;
      background: var(--jtt-track);
      transition: background 0.15s ease;
    }
    .jtt-toggle-track::before {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      transition: transform 0.15s ease;
    }
    .jtt-toggle input:checked + .jtt-toggle-track { background: var(--jtt-accent); }
    .jtt-toggle input:checked + .jtt-toggle-track::before { transform: translateX(14px); }
    .jtt-toggle input:focus-visible + .jtt-toggle-track { outline: 2px solid var(--jtt-accent); outline-offset: 2px; }
    .jtt-plan-block[data-inactive="true"] { opacity: 0.45; }
    .jtt-records[data-empty="true"] .jtt-balances { display: none; }
    .jtt-range-wrap { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 14px; font-size: 12px; color: var(--jtt-muted); }
    .jtt-range {
      display: flex;
      flex: 0 1 270px;
      gap: 2px;
      padding: 2px;
      border-radius: 6px;
      background: var(--jtt-track);
    }
    .jtt-range-btn {
      all: unset;
      flex: 1;
      padding: 5px 0;
      border-radius: 5px;
      font-size: 12px;
      font-weight: bolder;
      text-align: center;
      color: var(--jtt-muted);
      cursor: pointer;
    }
    .jtt-range-btn[aria-pressed="true"] { background: var(--jtt-bg-raised); color: var(--jtt-text-strong); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15); }
    .jtt-range-btn:focus-visible { outline: 2px solid var(--jtt-accent); }
    .jtt-h-zero { stroke: var(--jtt-muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.6; }
    .jtt-h-line { fill: none; stroke: var(--jtt-accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .jtt-h-dot { fill: var(--jtt-accent); }
    .jtt-h-dot[data-negative="true"], .jtt-h-last[data-negative="true"] { fill: var(--jtt-viol-bar); }
    .jtt-h-axis { fill: var(--jtt-muted); font-size: 10px; font-family: inherit; }
    .jtt-h-last { fill: var(--jtt-text); font-size: 11px; font-weight: bold; font-family: inherit; }
    .jtt-week-hint { margin-top: 8px; font-size: 11px; color: var(--jtt-muted); }
    .jtt-week-hint[hidden] { display: none; }
    .jtt-pause { margin-top: 8px; font-size: 13px; color: var(--jtt-muted); font-variant-numeric: tabular-nums; }
    .jtt-pause[hidden], .jtt-pause-goal[hidden] { display: none; }
    .jtt-pause-line { color: inherit; }
    .jtt-pause-goal[data-done="true"] { color: var(--jtt-accent-text); }
    .jtt-whatif { font-size: 14px; }
    .jtt-plan-block + .jtt-plan-block { margin-top: 14px; }
    .jtt-whatif-input.jtt-short { width: 4.6em; text-align: center; }
    .jtt-plan-block { padding: 2px 0; }
    .jtt-whatif-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 6px 8px;
    }
    .jtt-whatif-input {
      width: auto;
      height: auto;
      margin: 0;
      padding: 4px 8px;
      border: 1px solid var(--jtt-track);
      border-radius: 4px;
      background: var(--jtt-field);
      color: inherit;
      font: inherit;
      font-variant-numeric: tabular-nums;
      box-shadow: none;
    }
    .jtt-whatif-input:focus { outline: 2px solid var(--jtt-accent); outline-offset: 1px; }
    .jtt-whatif-result { margin-top: 6px; font-size: 18px; font-weight: bolder; font-variant-numeric: tabular-nums; }
    .jtt-whatif-result[data-sign="minus"] { color: var(--jtt-viol-bar); }
    .jtt-whatif-result[data-sign="plus"] { color: var(--jtt-accent-text); }
    .jtt-whatif-balance { margin-top: 3px; font-size: 12px; color: var(--jtt-muted); font-variant-numeric: tabular-nums; }
    .jtt-whatif-balance[hidden] { display: none; }
    .jtt-section { margin-top: 22px; }
    .jtt-section[hidden] { display: none; }
    .jtt-section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    .jtt-caption {
      font-size: 12px;
      font-weight: bolder;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--jtt-muted);
    }
    .jtt-caption-center { margin-bottom: 8px; }
    .jtt-section-sum { font-size: 12px; color: var(--jtt-muted); font-variant-numeric: tabular-nums; }
    .jtt-week { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
    .jtt-day { min-width: 0; }
    .jtt-day-track {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      height: 44px;
      border-radius: 3px;
      background: var(--jtt-track);
      overflow: hidden;
    }
    .jtt-day-fill { background: var(--jtt-accent); transition: height 0.6s ease; }
    .jtt-day-absence { background: var(--jtt-absence); }
    .jtt-day-over { background: var(--jtt-over); }
    .jtt-day-label { margin-top: 5px; font-size: 12px; color: var(--jtt-muted); }
    .jtt-day-value { font-size: 12px; font-variant-numeric: tabular-nums; }
    .jtt-day[data-today="true"] .jtt-day-label { color: var(--jtt-accent-text); font-weight: bolder; }
    .jtt-day[data-known="false"] .jtt-day-value { color: var(--jtt-muted); }
    .jtt-balances {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: 1fr;
      gap: 8px;
      font-variant-numeric: tabular-nums;
    }
    .jtt-balance[hidden] { display: none; }
    .jtt-balance { text-align: center; min-width: 0; }
    .jtt-balance-value { font-size: 17px; line-height: 1.25; white-space: nowrap; }
    .jtt-balance-value[data-negative="true"] { color: var(--jtt-viol-bar); }
    .jtt-balance-label { font-size: 12px; line-height: 1.3; color: var(--jtt-muted); }
    .jtt-ok {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 20px;
      font-size: 13px;
      color: var(--jtt-accent-text);
    }
    .jtt-ok[hidden] { display: none; }
    .jtt-ok svg { flex: none; }
    .jtt-alerts { margin: 0 -15px 15px; display: grid; gap: 6px; }
    .jtt-alert {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 20px 12px 16px;
      border-left: 4px solid var(--jtt-warn-bar);
      background: var(--jtt-warn-bg);
      color: var(--jtt-warn-text);
      font-size: 14px;
      line-height: 1.4;
      text-align: left;
    }
    .jtt-alert[data-type="violation"] {
      border-left-color: var(--jtt-viol-bar);
      background: var(--jtt-viol-bg);
      color: var(--jtt-viol-text);
    }
    .jtt-alert svg { flex: none; margin-top: 1px; }
    @media (prefers-reduced-motion: reduce) { .jtt-fill, .jtt-day-fill { transition: none; } }
  `;

  function sendToBackground(message) {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (err) {
      // Extension was reloaded while the page stayed open; a page reload fixes it.
    }
  }

  /** Picks the light or dark look from the page's own background. */
  function pageTheme() {
    const anchor = document.querySelector(".stempel-data");
    let el = anchor ? anchor.parentElement : document.body;
    while (el) {
      const match = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (match) {
        const [r, g, b, a = 1] = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        if (a > 0.5) return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4 ? "dark" : "light";
      }
      el = el.parentElement;
    }
    return "light";
  }

  // ------------------------------------------------------- whole-page look

  /**
   * Jazz itself only offers DE, FR and IT. For English, the German texts of the stamp page
   * are replaced in place. Only texts listed here are translated; anything else stays as it is.
   * Order matters: longer phrases first.
   */
  const PAGE_EN = [
    [/Stempeln f\u00fcr/g, "Time stamps for"],
    [/Stempel erfassen/g, "Record stamp"],
    [/Gestempelte Zeit/g, "stamped time"],
    [/Nicht gestempelt/g, "Not stamped"],
    [/Bemerkung \(optional\)/g, "Comment (optional)"],
    [/mehr anzeigen/g, "show more"],
    [/([\u2300\u2205\u00d8\u00f8])-Std\. per/g, "$1 hrs as of"],
    [/Zeitsaldo/g, "Time balance"],
    [/Feriensaldo/g, "Vacation balance"],
    [/inkl\. geplante Ferien/g, "incl. planned vacation"],
    [/\(per /g, "(as of "],
    [/\bFerien\b/g, "Vacation"],
    [/\bStd\./g, "hrs"],
    [/\bTage\b/g, "days"],
    [/\bHEUTE\b/g, "TODAY"],
    [/\bHeute\b/g, "Today"],
    [/\bMontag\b/g, "Monday"],
    [/\bDienstag\b/g, "Tuesday"],
    [/\bMittwoch\b/g, "Wednesday"],
    [/\bDonnerstag\b/g, "Thursday"],
    [/\bFreitag\b/g, "Friday"],
    [/\bSamstag\b/g, "Saturday"],
    [/\bSonntag\b/g, "Sunday"],
  ];

  class PageLook {
    constructor() {
      this.translated = new WeakMap(); // text node -> { original, english }
      this.wasEnglish = false;
      this.darkStyle = null;
    }

    eachTextNode(callback) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent || parent.closest("[data-jazz-extension], script, style, textarea")) {
            return NodeFilter.FILTER_REJECT;
          }
          return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      });
      let node;
      while ((node = walker.nextNode())) callback(node);
    }

    /** Called every tick, so texts Jazz renders later are picked up as well. */
    setLanguage(lang) {
      if (lang === "en") {
        this.wasEnglish = true;
        this.eachTextNode((node) => {
          const known = this.translated.get(node);
          if (known && known.english === node.nodeValue) return;
          let english = node.nodeValue;
          for (const [pattern, replacement] of PAGE_EN) english = english.replace(pattern, replacement);
          if (english === node.nodeValue) return;
          this.translated.set(node, { original: node.nodeValue, english });
          node.nodeValue = english;
        });
      } else if (this.wasEnglish) {
        this.wasEnglish = false;
        this.eachTextNode((node) => {
          const known = this.translated.get(node);
          if (known && known.english === node.nodeValue) node.nodeValue = known.original;
          this.translated.delete(node);
        });
      }
    }

    /**
     * Dark mode for the whole page by inverting it; pictures are inverted back.
     * The status block keeps its light colours and is darkened together with the page.
     */
    setDark(dark) {
      // early.js may already have darkened the page while it was loading
      if (!this.darkStyle) this.darkStyle = document.querySelector("style[data-jazz-extension-dark]");
      if (dark && !this.darkStyle) {
        const style = document.createElement("style");
        style.setAttribute("data-jazz-extension-dark", "");
        style.textContent = `
          html { background: #ffffff !important; filter: invert(0.92) hue-rotate(180deg); }
          html img, html video, html picture { filter: invert(1) hue-rotate(180deg); }
        `;
        (document.head || document.documentElement).appendChild(style);
        this.darkStyle = style;
      } else if (!dark && this.darkStyle) {
        this.darkStyle.remove();
        this.darkStyle = null;
      }
    }

    reset() {
      this.setLanguage("de");
      this.setDark(false);
    }
  }

  // ------------------------------------------------------------ page reader

  class TimeReader {
    readTimes() {
      return {
        checkpoints: this.readCheckpoints(),
        absenceTime: this.readAbsenceTime(),
        previousDayEnd: this.readPreviousDayEndTime(),
      };
    }

    /** Today's stamps as "H:MM" strings. Empty if nothing is stamped yet. */
    readCheckpoints() {
      const out = [];
      document.querySelectorAll(".today.stempel-day .time").forEach((el) => {
        if (el.textContent !== "00:00") out.push(Time.from(el.textContent).toString());
      });
      return out;
    }

    readAbsenceTime() {
      let total = Time.of(0, 0);
      document.querySelectorAll(".today.stempel-day .absence-type").forEach((el) => {
        const match = el.textContent.trim().match(/(\d+):(\d+)\s*(?:Std\.|hrs)/);
        if (match) total = total.add(Time.of(parseInt(match[1], 10), parseInt(match[2], 10)));
      });
      return total;
    }

    /**
     * The balances Jazz prints at the bottom of the stamp page, e.g.
     * "Zeitsaldo: −2:53 Std. (per 04.10.2026)" and "Feriensaldo ...: 0.00 Tage (per 31.12.2026)".
     * Found by their German labels; returns null for a balance that is not on the page.
     */
    readBalances() {
      const now = Date.now();
      if (this.balances && now - this.balancesReadAt < 5000) return this.balances;
      this.balancesReadAt = now;

      // German labels, or the English ones this extension puts on the page itself.
      const timeRe =
        /(?:Zeitsaldo|Time balance)[\s\S]{0,80}?([\u2212\u2013+-]?\s?\d+:\d{2})\s*(?:Std\.?|hrs)\s*(?:\((?:per|as of)\s*([\d.]+)\))?/;
      const vacationRe =
        /(?:Feriensaldo|Vacation balance)[\s\S]{0,120}?([\u2212\u2013+-]?\s?\d+(?:[.,]\d+)?)\s*(?:Tage|days)\s*(?:\((?:per|as of)\s*([\d.]+)\))?/;
      const clean = (value) => value.replace(/\s/g, "").replace(/[\u2013-]/, "\u2212");
      const find = (labels, re) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!labels.some((label) => node.nodeValue.includes(label))) continue;
          let el = node.parentElement;
          if (!el || el.closest("[data-jazz-extension]")) continue;
          for (let depth = 0; el && depth < 6; depth++, el = el.parentElement) {
            const match = el.textContent.match(re);
            if (match) return { value: clean(match[1]), asOf: match[2] || "" };
          }
        }
        return null;
      };
      this.balances = {
        time: find(["Zeitsaldo", "Time balance"], timeRe),
        vacation: find(["Feriensaldo", "Vacation balance"], vacationRe),
      };
      return this.balances;
    }

    /**
     * Worked and absence minutes of the other days on the page, keyed by "DD.MM.YYYY".
     * Today is not included; it comes from the live calculation.
     */
    readOtherDays() {
      const now = Date.now();
      if (this.otherDays && now - this.otherDaysReadAt < 5000) return this.otherDays;
      this.otherDaysReadAt = now;
      const days = {};
      document.querySelectorAll(".stempel-day:not(.today)").forEach((day) => {
        const text = day.textContent;
        const date = text.match(/(\d{2}\.\d{2}\.\d{4})/);
        if (!date) return;

        // Jazz's own "3:45 Gestempelte Zeit" line, read from its own text node so that
        // neighbouring numbers (date, average hours) cannot run into it.
        let worked = null;
        let stamped = null;
        const stampedRe = /(\d{1,2}):(\d{2})\s*(?:Gestempelte Zeit|stamped time)/i;
        const walker = document.createTreeWalker(day, NodeFilter.SHOW_TEXT);
        let node;
        while (!stamped && (node = walker.nextNode())) {
          if (!/Gestempelte Zeit|stamped time/i.test(node.nodeValue)) continue;
          stamped = node.nodeValue.match(stampedRe) || node.parentElement.textContent.match(stampedRe);
        }
        if (stamped) {
          worked = 60 * parseInt(stamped[1], 10) + parseInt(stamped[2], 10);
        } else {
          worked = 0;
          day.querySelectorAll(".stempel-pair").forEach((pair) => {
            let times = pair.querySelectorAll(".stempel-time");
            if (times.length < 2) times = pair.querySelectorAll(".time");
            if (times.length < 2) return;
            const from = parseSignedTime(times[0].textContent);
            const to = parseSignedTime(times[1].textContent);
            if (from !== null && to !== null && to > from) worked += to - from;
          });
        }

        let absence = 0;
        day.querySelectorAll(".absence-type").forEach((el) => {
          const match = el.textContent.trim().match(/(\d+):(\d+)\s*(?:Std\.|hrs)/);
          if (match) absence += 60 * parseInt(match[1], 10) + parseInt(match[2], 10);
        });
        const pairs = [];
        day.querySelectorAll(".stempel-pair").forEach((pair) => {
          let times = pair.querySelectorAll(".stempel-time");
          if (times.length < 2) times = pair.querySelectorAll(".time");
          if (times.length < 2) return;
          const from = parseSignedTime(times[0].textContent);
          const to = parseSignedTime(times[1].textContent);
          if (from !== null && to !== null && to > from) pairs.push([from, to]);
        });
        days[date[1]] = { worked: worked + absence, absence, pairs };
      });
      this.otherDays = days;
      return days;
    }

    readPreviousDayEndTime() {
      const day = document.querySelector(".stempel-day:not(.today)");
      if (!day) return null;
      const pair = day.querySelector(".text-center.stempel-pair");
      if (!pair) return null;
      const times = pair.querySelectorAll("div.stempel-time");
      if (times.length < 2) return null;
      const text = times[1].textContent.trim();
      return text !== "00:00" && text ? Time.from(text) : null;
    }
  }

  // ------------------------------------------------------------- day panel

  const DEFAULT_PLAN = { leave: "17:00", lunchAt: "12:00", lunchMin: "45", goal: "0:00", goalDate: "", goalActive: true };

  /** Sentence for the break window (the popup has the same logic). */
  function describeBreakWindow(win, t) {
    if (!win.needed) return t("breakWindowNone");
    if (win.twoBreaks) return t("breakWindowTwo", { to: win.latest.toString() });
    if (win.earliest.totalMinutes <= new Time().totalMinutes) return t("breakWindowNow", { to: win.latest.toString() });
    return t("breakWindow", { from: win.earliest.toString(), to: win.latest.toString() });
  }

  /** Stamps ["7:30","12:00","12:30"] -> pairs [[450,720],[750,now]]. */
  function pairsFromStamps(stamps, now = null) {
    const minutes = stamps.map((s) => parseSignedTime(s)).filter((m) => m !== null).sort((a, b) => a - b);
    if (minutes.length % 2 === 1) {
      if (now === null) minutes.pop();
      else minutes.push(now);
    }
    const pairs = [];
    for (let i = 0; i + 1 < minutes.length; i += 2) if (minutes[i + 1] > minutes[i]) pairs.push([minutes[i], minutes[i + 1]]);
    return pairs;
  }

  /**
   * Records over all known past working days: earliest start, longest day, and the run of
   * days without a broken break rule (too long without a break, or too little break).
   */
  function buildRecords(dates, byDate, settings) {
    if (!dates.length) return null;
    const rules = new ComplianceRules(settings.isApprentice, false, true);
    const breakRules = ["noBreak15", "noBreak30", "break60Missing"];
    let earliest = null;
    let longest = null;
    let run = 0;
    let best = 0;
    for (const date of dates) {
      const pairs = byDate[date];
      const start = pairs[0][0];
      const worked = workedUntil(pairs, 24 * 60);
      if (!earliest || start < earliest.minute) earliest = { date, minute: start };
      if (!longest || worked > longest.minutes) longest = { date, minutes: worked };
      const stamps = pairs.flat().map((m) => new Time(m).toString());
      const broken = rules.checkAll(stamps).some((f) => f.type === "violation" && breakRules.includes(f.key));
      run = broken ? 0 : run + 1;
      best = Math.max(best, run);
    }
    return { earliest, longest, streak: run, best, days: dates.length };
  }

  function targetMinutesToday(settings) {
    const key = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];
    const cfg = (settings.dailyHours && settings.dailyHours[key]) || { hours: 8, minutes: 12 };
    return 60 * cfg.hours + cfg.minutes;
  }

  /** Minutes worked up to `minute` of the day. */
  function workedUntil(pairs, minute) {
    let sum = 0;
    for (const [from, to] of pairs) sum += Math.max(0, Math.min(to, minute) - from);
    return sum;
  }

  const HELP_KEYS = ["status", "bar", "breaks", "clockout", "balances", "menu", "top", "icon", "popup"];

  function endOfMonthKey() {
    const now = new Date();
    return todayKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  }

  class DayPanel {
    constructor() {
      this.root = null;
      this.refs = {};
      this.plan = { ...DEFAULT_PLAN };
      this.onPlanChange = null;
      this.menuOpen = false;
      this.onAction = null; // called with "lang-de", "lang-en", "whatIf", "week" or "dark"
    }

    update({ status, lang, settings, checkpoints, rulesOk, balances, clockOut, week, open, dark, schoolDay, history, dayCurves }) {
      const anchor = document.querySelector(".stempel-data");
      if (!anchor || !anchor.parentElement) return;
      if (!this.root || !this.root.isConnected) this.create(anchor);

      const t = (key, params) => translate(lang, key, params);
      const over = Boolean(status.overtime);
      const { refs } = this;

      this.root.dataset.jttTheme = pageTheme();
      this.root.dataset.over = String(over);
      refs.title.textContent = t("panelTitle");
      this.root.dataset.school = String(Boolean(schoolDay));
      refs.schoolLine.textContent = t("schoolToday");
      refs.schoolNote.textContent = t("schoolTodayNote");

      // Only two states: clocked in or clocked out.
      refs.chip.dataset.state = status.clockedIn ? "in" : "out";
      refs.chip.textContent = status.clockedIn ? t("clockedIn") : t("clockedOut");
      refs.clockOut.hidden = !clockOut;
      refs.clockOut.textContent = t("clockOutNow");

      // Break timer, only while a break is running.
      const pause = runningBreak(status, checkpoints);
      refs.pause.hidden = !pause;
      if (pause) {
        refs.pauseLine.textContent = t("breakRunning", {
          since: pause.since.toString(),
          current: new Time(pause.current).toString(),
        });
        const done = pause.remaining === 0;
        refs.pauseGoal.hidden = pause.required === 0;
        refs.pauseGoal.dataset.done = String(done);
        refs.pauseGoal.textContent = done
          ? t("breakDone", { n: pause.required })
          : t("breakLeft", { time: new Time(pause.remaining).toString(), n: pause.required });
      }

      refs.spentValue.textContent = status.timeSpent.toString();
      refs.spentLabel.textContent = t("timeSpent");
      refs.toGoValue.textContent = status.timeToGo.toString(); // negative once the target is passed
      refs.toGoLabel.textContent = t("timeToGo");
      refs.homeValue.textContent = status.goHomeTime.toString();
      refs.homeLabel.textContent = t("goHome");

      // Bar: green = stamped work, blue = absence booked in Jazz (e.g. an appointment),
      // orange = overtime. In overtime the bar covers the whole day instead of the target.
      const targetMin = status.target.totalMinutes;
      const spentMin = Math.max(0, status.timeSpent.totalMinutes);
      const percent = targetMin > 0 ? Math.round((spentMin / targetMin) * 100) : 0;
      const scale = Math.max(targetMin, spentMin) || 1;
      const countedMin = Math.min(spentMin, targetMin);
      const absenceMin = Math.min(Math.max(0, status.absence.totalMinutes), countedMin);
      const share = (minutes) => `${(minutes / scale) * 100}%`;
      refs.fill.style.width = share(countedMin - absenceMin);
      refs.fillAbsence.style.width = share(absenceMin);
      refs.fillOver.style.width = share(spentMin - countedMin);
      refs.bar.setAttribute("aria-valuenow", String(Math.min(100, percent)));
      refs.bar.setAttribute("aria-label", t("timeSpent"));
      refs.percent.textContent = `${percent} %`;
      refs.breakLabel.textContent = `${t("breakTaken")} `;
      refs.breakValue.textContent = status.breaks.toString();
      refs.absenceWrap.hidden = status.absence.totalMinutes <= 0;
      refs.absenceLabel.textContent = `${t("absence")} `;
      refs.absenceValue.textContent = status.absence.toString();
      refs.overWrap.dataset.over = String(over);
      refs.overLabel.textContent = `${t("overtime")} `;
      refs.overValue.textContent = over ? `+${status.overtime.toString()}` : "0:00";

      const win = over ? null : breakWindow(status, checkpoints);
      refs.breakWin.hidden = !win;
      if (win) refs.breakWin.textContent = describeBreakWindow(win, t);

      // The saved balance goal, every day: "today +0:50".
      const goalOn = this.plan.goalActive !== false;
      const goalText =
        schoolDay || !goalOn ? null : describeGoalToday(goalToday(this.plan, balances, status, this.school || {}), lang);
      refs.goalLine.hidden = !goalText;
      if (goalText) {
        refs.goalLine.textContent = goalText.text;
        refs.goalLine.dataset.kind = goalText.kind;
      }

      // Tool buttons
      const pressed = {
        "lang-de": lang === "de",
        "lang-en": lang === "en",
        whatIf: open.whatIf,
        week: open.week,
        goal: open.goal,
        history: open.history,
        records: open.records,
        help: open.help,
        dark,
      };
      const labels = {
        "lang-de": "Deutsch",
        "lang-en": "English",
        whatIf: t("toolWhatIf"),
        week: t("toolWeek"),
        goal: t("toolGoal"),
        history: t("toolHistory"),
        records: t("toolRecords"),
        help: t("toolHelp"),
        dark: t("toolDark"),
      };
      for (const name of Object.keys(pressed)) {
        const btn = refs[`btn_${name}`];
        const inMenu = btn.getAttribute("role") === "menuitemcheckbox";
        btn.setAttribute(inMenu ? "aria-checked" : "aria-pressed", String(Boolean(pressed[name])));
        if (inMenu) {
          btn.querySelector(".jtt-menu-label").textContent = labels[name];
        } else {
          btn.title = labels[name];
          btn.setAttribute("aria-label", labels[name]);
        }
      }
      this.updateHelp(Boolean(open.help), t, lang);
      refs.more.title = t("toolMore");
      refs.more.setAttribute("aria-label", t("toolMore"));
      // Shows that at least one of the sections in the menu is open.
      refs.more.dataset.active = String(Boolean(open.whatIf || open.week || open.goal || open.history || open.records));

      refs.whatIf.hidden = !open.whatIf;
      if (open.whatIf) this.updateWhatIf(status, balances, t);
      this.updateWeek(open.week ? week : null, t);
      this.updateHistory(open.history ? history : null, t, open.range || "week");
      if (open.history) {
        // The selector picks how many past days the "normal" line is averaged from.
        const range = open.range || "week";
        refs.rangeLabel.textContent = t("rangeLabel");
        for (const btn of refs.rangeButtons) {
          btn.setAttribute("aria-pressed", String(btn.dataset.range === range));
          btn.textContent = t(`range_${btn.dataset.range}`);
        }
        this.updateDayChart(status, checkpoints, dayCurves, t, lang);
      }
      this.updateRecords(open.records && dayCurves ? dayCurves.records : null, t, Boolean(open.records));
      refs.goal.hidden = !open.goal;
      if (open.goal) this.updateGoal(status, balances, t);
      this.updateBalances(status, balances, t, Boolean(schoolDay));

      refs.ok.hidden = !rulesOk;
      refs.okText.textContent = t("rulesOk");
    }

    /** Three record tiles under the day chart. */
    updateRecords(records, t, show = false) {
      const { refs } = this;
      refs.records.hidden = !show;
      if (!show) return;
      if (!records) {
        refs.recordsTitle.textContent = t("recordsTitleEmpty");
        refs.records.dataset.empty = "true";
        return;
      }
      refs.records.dataset.empty = "false";
      const day = (iso) => {
        const date = new Date(`${iso}T00:00:00`);
        const key = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][date.getDay()];
        return `${t(`dayShort_${key}`)} ${date.getDate()}.${date.getMonth() + 1}.`;
      };
      refs.recordsTitle.textContent = t("recordsTitle", { n: records.days });
      refs.recEarliestValue.textContent = new Time(records.earliest.minute).toString();
      refs.recEarliestLabel.textContent = t("recEarliest");
      refs.recEarliestSub.textContent = day(records.earliest.date);
      refs.recLongestValue.textContent = new Time(records.longest.minutes).toString();
      refs.recLongestLabel.textContent = t("recLongest");
      refs.recLongestSub.textContent = day(records.longest.date);
      refs.recStreakValue.textContent = t(records.streak === 1 ? "recDay" : "recDays", { n: records.streak });
      refs.recStreakLabel.textContent = t("recStreak");
      refs.recStreakSub.textContent = t("recBest", { n: records.best });
    }

    /** The help list; rebuilt only when it is opened or the language changes. */
    updateHelp(show, t, lang) {
      const { refs } = this;
      refs.help.hidden = !show;
      if (!show || this.helpLang === lang) return;
      this.helpLang = lang;
      refs.helpTitle.textContent = t("helpTitle");
      refs.helpList.textContent = "";
      for (const key of HELP_KEYS) {
        const term = document.createElement("dt");
        term.textContent = t(`help_${key}_term`);
        const text = document.createElement("dd");
        text.textContent = t(`help_${key}_text`);
        refs.helpList.append(term, text);
      }
    }

    syncMenu() {
      this.refs.menu.dataset.open = String(this.menuOpen);
      this.refs.more.setAttribute("aria-expanded", String(this.menuOpen));
      this.refs.more.setAttribute("aria-pressed", String(this.menuOpen));
    }

    /** Keeps an input in sync with the stored plan, but never while the user is typing in it. */
    syncInput(input, value) {
      if (document.activeElement !== input && input.value !== value) input.value = value;
    }

    /** The "Plan" section: leave-at, lunch break and balance goal. */
    updateWhatIf(status, balances, t) {
      const { refs, plan } = this;
      refs.planTitle.textContent = t("planTitle");

      // 1. If I leave at ...
      refs.whatIfBefore.textContent = t("whatIfBefore");
      refs.whatIfAfter.textContent = t("whatIfAfter");
      refs.whatIfInput.setAttribute("aria-label", t("toolWhatIf"));
      this.syncInput(refs.whatIfInput, plan.leave);
      const leave = parseSignedTime(refs.whatIfInput.value || "");
      const base = balances && balances.time ? parseSignedTime(balances.time.value) : null;
      if (leave === null) {
        refs.whatIfResult.textContent = "\u2013";
        refs.whatIfResult.dataset.sign = "";
        refs.whatIfBalance.hidden = true;
      } else {
        const diff = leaveAtDifference(status, leave);
        refs.whatIfResult.textContent = formatSigned(diff);
        refs.whatIfResult.dataset.sign = diff < 0 ? "minus" : "plus";
        const withToday = timeBalanceWithToday(balances, status);
        refs.whatIfBalance.hidden = base === null || withToday === null;
        if (base !== null && withToday !== null) {
          refs.whatIfBalance.textContent = t("whatIfBalance", { value: formatSigned(base + diff) });
        }
      }

      // 2. Lunch break: "Break at 12:00 for 45 min -> go home at ..."
      refs.lunchBefore.textContent = t("lunchBefore");
      refs.lunchMiddle.textContent = t("lunchMiddle");
      refs.lunchAfter.textContent = t("lunchAfter");
      refs.lunchAt.setAttribute("aria-label", t("lunchAtLabel"));
      refs.lunchMin.setAttribute("aria-label", t("lunchMinLabel"));
      this.syncInput(refs.lunchAt, plan.lunchAt);
      this.syncInput(refs.lunchMin, plan.lunchMin);
      const lunchAt = parseSignedTime(refs.lunchAt.value || "");
      const lunchMin = parseInt(refs.lunchMin.value, 10);
      const planned = status.clockedIn && lunchAt !== null && lunchMin >= 0 ? plannedGoHome(status, lunchAt, lunchMin) : null;
      refs.lunchResult.textContent = planned ? t("lunchResult", { time: planned.goHome.toString() }) : "\u2013";
      refs.lunchNote.textContent = !status.clockedIn
        ? t("lunchOnlyClockedIn")
        : planned
          ? planned.remaining === 0
            ? t("lunchDone")
            : planned.added > 0
              ? t("lunchNoteTopped", { end: planned.breakEnd.toString(), n: status.minimumBreak.totalMinutes })
              : t("lunchNote", { end: planned.breakEnd.toString() })
          : "";

    }

    /**
     * Today vs a normal day, like the step chart in Apple Health: worked hours added up
     * over the day. The normal line is the average of the past working days the extension
     * knows; it flattens where you usually take your break.
     */
    updateDayChart(status, checkpoints, curves, t, lang) {
      const { refs } = this;
      refs.dayTitle.textContent = t("dayChartTitle");
      const now = new Time().totalMinutes;
      const signature = JSON.stringify([checkpoints, now, curves.days, curves.model, status.target.totalMinutes, lang]);
      if (signature === this.daySignature) return;
      this.daySignature = signature;

      const todayPairs = pairsFromStamps(checkpoints, status.clockedIn ? now : null);
      const normal = (minute) => {
        if (curves.days.length === 0) return 0;
        let sum = 0;
        for (const pairs of curves.days) sum += workedUntil(pairs, minute);
        return sum / curves.days.length;
      };
      const today = (minute) => workedUntil(todayPairs, Math.min(minute, now));

      // Time axis: from the earliest start to the latest end, in whole hours.
      const starts = [...curves.days.map((p) => p[0][0]), ...todayPairs.map((p) => p[0])];
      const ends = [...curves.days.map((p) => p[p.length - 1][1]), now, status.goHomeTime.totalMinutes];
      const xMin = Math.floor((Math.min(...starts, 8 * 60) - 30) / 60) * 60;
      const xMax = Math.ceil((Math.max(...ends) + 15) / 60) * 60;
      const target = status.target.totalMinutes;
      const yMax = Math.ceil(Math.max(target, today(xMax), normal(xMax)) / 60) * 60 || 60;

      const W = 340;
      const H = 150;
      const pad = { l: 26, r: 10, t: 10, b: 20 };
      const x = (m) => pad.l + ((m - xMin) / (xMax - xMin)) * (W - pad.l - pad.r);
      const y = (v) => pad.t + (1 - v / yMax) * (H - pad.t - pad.b);
      const path = (fn, until) => {
        const pts = [];
        for (let m = xMin; m <= until; m += 5) pts.push(`${pts.length ? "L" : "M"}${x(m).toFixed(1)},${y(fn(m)).toFixed(1)}`);
        if ((until - xMin) % 5) pts.push(`L${x(until).toFixed(1)},${y(fn(until)).toFixed(1)}`);
        return pts.join("");
      };
      const hours = [];
      for (let m = xMin; m <= xMax; m += 60) if ((m - xMin) % (xMax - xMin > 600 ? 120 : 60) === 0) hours.push(m);
      const yTicks = [];
      for (let v = 0; v <= yMax; v += yMax > 480 ? 240 : 120) yTicks.push(v);
      const nowClamped = Math.max(xMin, Math.min(now, xMax));
      const todayEnd = todayPairs.length ? nowClamped : xMin;
      const diff = Math.round(today(now) - normal(now));

      refs.dayChart.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t("dayChartTitle")}">
          ${yTicks.map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="jtt-d-grid"/><text x="${pad.l - 5}" y="${y(v) + 3}" text-anchor="end" class="jtt-h-axis">${v / 60}h</text>`).join("")}
          ${hours.map((m) => `<text x="${x(m)}" y="${H - 5}" text-anchor="middle" class="jtt-h-axis">${m / 60}</text>`).join("")}
          <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(target)}" y2="${y(target)}" class="jtt-d-target"/>
          <text x="${pad.l + 4}" y="${y(target) - 4}" class="jtt-h-axis">${t("target")} ${status.target.toString()}</text>
          <path d="${path(normal, xMax)}" class="jtt-d-normal"/>
          ${todayPairs.length ? `<path d="${path(today, todayEnd)}" class="jtt-d-today"/><circle cx="${x(todayEnd)}" cy="${y(today(todayEnd))}" r="4" class="jtt-d-dot"/>` : ""}
          <line class="jtt-d-cross" y1="${pad.t}" y2="${H - pad.b}" x1="0" x2="0" visibility="hidden"/>
          <rect class="jtt-d-hit" x="${pad.l}" y="${pad.t}" width="${W - pad.l - pad.r}" height="${H - pad.t - pad.b}" fill="transparent"/>
        </svg>
        <div class="jtt-d-tip" hidden></div>`;

      // Crosshair and tooltip
      const svgEl = refs.dayChart.querySelector("svg");
      const cross = svgEl.querySelector(".jtt-d-cross");
      const tip = refs.dayChart.querySelector(".jtt-d-tip");
      const hit = svgEl.querySelector(".jtt-d-hit");
      hit.addEventListener("mousemove", (event) => {
        const box = svgEl.getBoundingClientRect();
        const px = ((event.clientX - box.left) / box.width) * W;
        const minute = Math.round((xMin + ((px - pad.l) / (W - pad.l - pad.r)) * (xMax - xMin)) / 5) * 5;
        cross.setAttribute("x1", x(minute));
        cross.setAttribute("x2", x(minute));
        cross.setAttribute("visibility", "visible");
        const parts = [new Time(minute).toString()];
        if (minute <= now && todayPairs.length) parts.push(`${t("dayToday")} ${new Time(Math.round(today(minute))).toString()}`);
        parts.push(`${t("dayNormal")} ${new Time(Math.round(normal(minute))).toString()}`);
        tip.textContent = parts.join(" \u00b7 ");
        tip.hidden = false;
      });
      hit.addEventListener("mouseleave", () => {
        cross.setAttribute("visibility", "hidden");
        tip.hidden = true;
      });

      refs.daySum.textContent = todayPairs.length
        ? Math.abs(diff) < 5
          ? t("dayEven")
          : t(diff > 0 ? "dayAhead" : "dayBehind", { value: new Time(Math.abs(diff)).toString() })
        : "";
      refs.dayLegend.innerHTML = `<span class="jtt-leg jtt-leg-today">${t("dayToday")}</span><span class="jtt-leg jtt-leg-normal">${t(curves.model ? "dayModel" : "dayNormal")}</span>`;
      refs.dayNote.textContent = curves.model
        ? t("dayModelNote")
        : t("dayNormalNote", { n: curves.days.length });
    }

    /** Line of the recorded time balances (last 12 weeks), with the zero line. */
    updateHistory(history, t, range = "week") {
      const { refs } = this;
      refs.history.hidden = !history;
      if (!history) return;
      refs.historyTitle.textContent = t("historyTitle");
      // Same period as the selector above.
      const since = new Date();
      since.setDate(since.getDate() - ({ three: 2, week: 6, month: 29, max: 3650 }[range] ?? 6));
      const sinceKey = todayKey(since);
      const points = Object.keys(history)
        .filter((k) => k >= sinceKey)
        .sort()
        .map((k) => ({ key: k, value: history[k] }));
      const signature = JSON.stringify(points) + t("historyTitle") + range;
      if (signature === this.historySignature) return;
      this.historySignature = signature;

      const short = (key) => `${key.slice(8, 10)}.${key.slice(5, 7)}.`;
      if (points.length === 0) {
        refs.historyChart.innerHTML = "";
        refs.historySum.textContent = "";
        refs.historyNote.textContent = t("historyEmpty");
        return;
      }
      const first = points[0];
      const last = points[points.length - 1];
      refs.historySum.textContent =
        points.length > 1
          ? t("historyChange", { from: short(first.key), value: formatSigned(last.value - first.value) })
          : "";
      refs.historyNote.textContent = points.length < 3 ? t("historyFew") : "";

      // Chart in a fixed coordinate space; it scales with the block width.
      const W = 340;
      const H = 110;
      const pad = { l: 6, r: 46, t: 12, b: 20 };
      const day = (key) => new Date(`${key}T00:00:00`).getTime() / 86400000;
      const x0 = day(first.key);
      const span = Math.max(1, day(last.key) - x0);
      const values = points.map((p) => p.value);
      const lo = Math.min(0, ...values);
      const hi = Math.max(0, ...values);
      const span2 = Math.max(30, hi - lo);
      const x = (key) => pad.l + ((day(key) - x0) / span) * (W - pad.l - pad.r);
      const y = (v) => pad.t + ((hi - v) / span2) * (H - pad.t - pad.b);
      const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.key).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
      const lastNegative = last.value < 0;
      refs.historyChart.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${t("historyTitle")}">
          <line x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}" class="jtt-h-zero"/>
          <text x="${W - pad.r + 6}" y="${y(0) + 4}" class="jtt-h-axis">0:00</text>
          ${points.length > 1 ? `<path d="${line}" class="jtt-h-line"/>` : ""}
          <circle cx="${x(last.key)}" cy="${y(last.value)}" r="3.5" class="jtt-h-dot" data-negative="${lastNegative}"/>
          <text x="${W - pad.r + 6}" y="${y(last.value) + 4}" class="jtt-h-last" data-negative="${lastNegative}">${formatSigned(last.value)}</text>
          <text x="${pad.l}" y="${H - 4}" class="jtt-h-axis">${short(first.key)}</text>
          ${points.length > 1 ? `<text x="${W - pad.r}" y="${H - 4}" text-anchor="end" class="jtt-h-axis">${short(last.key)}</text>` : ""}
        </svg>`;
    }

    /** Own section: what the time balance needs per day to reach a goal by a date. */
    updateGoal(status, balances, t) {
      const { refs, plan } = this;
      refs.goalTitle.textContent = t("goalTitle");
      const active = plan.goalActive !== false;
      if (document.activeElement !== refs.goalActive) refs.goalActive.checked = active;
      refs.goalActiveLabel.textContent = t(active ? "goalOn" : "goalOff");
      refs.goalBlock.dataset.inactive = String(!active);
      const base = balances && balances.time ? parseSignedTime(balances.time.value) : null;
      refs.goalBefore.textContent = t("goalBefore");
      refs.goalMiddle.textContent = t("goalMiddle");
      refs.goalInput.setAttribute("aria-label", t("goalLabel"));
      refs.goalDate.setAttribute("aria-label", t("goalDateLabel"));
      this.syncInput(refs.goalInput, plan.goal);
      this.syncInput(refs.goalDate, plan.goalDate || endOfMonthKey());
      const goal = parseSignedTime(refs.goalInput.value || "");
      const until = refs.goalDate.value;
      const result =
        base !== null && goal !== null && until
          ? goalPerDay(base, goal, until, balances.time.asOf, status, this.school || {})
          : null;
      refs.goalResult.dataset.sign = "";
      if (base === null) {
        refs.goalResult.textContent = "\u2013";
        refs.goalNote.textContent = t("goalNoBalance");
      } else if (!result) {
        refs.goalResult.textContent = "\u2013";
        refs.goalNote.textContent = "";
      } else if (result.days === 0) {
        refs.goalResult.textContent = "\u2013";
        refs.goalNote.textContent = t("goalNoDays");
      } else if (result.perDay <= 0) {
        refs.goalResult.textContent = t("goalReached");
        refs.goalResult.dataset.sign = "plus";
        refs.goalNote.textContent = t("goalReachedNote", { days: result.days, value: formatSigned(-result.perDay) });
      } else {
        refs.goalResult.textContent = t("goalPerDay", { value: formatSigned(result.perDay) });
        refs.goalResult.dataset.sign = "minus";
        refs.goalNote.textContent = result.todayGoHome
          ? t("goalNote", { days: result.days, time: result.todayGoHome.toString() })
          : t("goalNoteNoToday", { days: result.days });
      }
    }

    /** Monday to Friday as small columns. `week` is a list of { day, target, worked, absence, isToday } or null. */
    updateWeek(week, t) {
      const { refs } = this;
      refs.week.hidden = !week;
      if (!week) return;
      refs.weekTitle.textContent = t("weekTitle");
      let done = 0;
      let total = 0;
      week.forEach((entry, i) => {
        const col = refs.weekCols[i];
        const known = entry.worked !== null;
        const worked = known ? entry.worked : 0;
        // A school day without any work is shown as school and left out of the totals.
        const schoolOnly = entry.school && worked === 0;
        col.root.dataset.school = String(schoolOnly);
        col.root.dataset.today = String(entry.isToday);
        col.label.textContent = t(`dayShort_${entry.day}`);
        if (schoolOnly) {
          col.work.style.height = "0%";
          col.absence.style.height = "0%";
          col.over.style.height = "0%";
          col.value.textContent = t("schoolShort");
          col.root.title = `${t(entry.day)}: ${t("school")}`;
          return;
        }
        const absence = known ? Math.min(entry.absence, worked) : 0;
        const target = entry.target || 1;
        const scale = Math.max(target, worked);
        done += worked;
        total += entry.target;
        col.root.dataset.today = String(entry.isToday);
        col.root.dataset.known = String(known);
        col.work.style.height = `${((Math.min(worked, target) - Math.min(absence, target)) / scale) * 100}%`;
        col.absence.style.height = `${(Math.min(absence, target) / scale) * 100}%`;
        col.over.style.height = `${(Math.max(0, worked - target) / scale) * 100}%`;
        col.label.textContent = t(`dayShort_${entry.day}`);
        col.value.textContent = known && worked > 0 ? new Time(worked).toString() : "–";
        col.root.title = `${t(entry.day)}: ${known ? new Time(worked).toString() : "–"} / ${new Time(entry.target).toString()}`;
      });
      refs.weekSum.textContent = t("weekSum", { done: new Time(done).toString(), total: new Time(total).toString() });
      refs.weekHint.hidden = !week.some((entry) => entry.school);
      refs.weekHint.textContent = t("schoolHint");
    }

    updateBalances(status, balances, t, schoolDay = false) {
      const { refs } = this;
      const shortDate = (date) => date.replace(/^(\d{1,2}\.\d{1,2}\.)\d{2,4}$/, "$1");
      const set = (name, value, labelTop, labelBottom) => {
        refs[`${name}Row`].hidden = value === null;
        if (value === null) return false;
        refs[`${name}Value`].textContent = value;
        refs[`${name}Value`].dataset.negative = String(value.startsWith("−"));
        refs[`${name}Label`].textContent = labelTop;
        refs[`${name}Sub`].textContent = labelBottom;
        return true;
      };
      const time = balances && balances.time;
      const vacation = balances && balances.vacation;
      // On a school day without work, today adds nothing to the balance, so there is no extra figure.
      const withToday = schoolDay ? null : timeBalanceWithToday(balances, status);
      const asOf = (b) => (b.asOf ? t("asOf", { date: shortDate(b.asOf) }) : "");
      const any = [
        set("time", time ? `${time.value} ${t("unitHours")}` : null, t("timeBalance"), time ? asOf(time) : ""),
        set(
          "timeToday",
          withToday !== null ? `${formatSigned(withToday)} ${t("unitHours")}` : null,
          t("timeBalance"),
          t("balanceToday"),
        ),
        set(
          "vacation",
          vacation ? `${vacation.value} ${t("unitDays")}` : null,
          t("vacationBalance"),
          vacation ? asOf(vacation) : "",
        ),
      ].some(Boolean);
      refs.balances.hidden = !any;
      refs.balancesTitle.textContent = t("balancesTitle");
    }

    create(anchor) {
      const el = (tag, className, parent) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (parent) parent.appendChild(node);
        return node;
      };
      const { refs } = this;
      const root = el("section", "jtt-panel");
      root.setAttribute("data-jazz-extension", "");

      // Top left: language. Top right: what-if, week and dark mode.
      const svg = (path) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">${path}</svg>`;
      const button = (parent, name, content) => {
        const btn = el("button", "jtt-btn", parent);
        btn.type = "button";
        btn.innerHTML = content;
        btn.addEventListener("click", () => this.onAction && this.onAction(name));
        refs[`btn_${name}`] = btn;
        return btn;
      };
      const left = el("div", "jtt-tools jtt-tools-left jtt-lang", root);
      button(left, "lang-de", "DE");
      button(left, "lang-en", "EN");
      const right = el("div", "jtt-tools jtt-tools-right", root);
      // "More" opens a small menu with the four sections; dark mode stays a direct button.
      refs.more = el("button", "jtt-btn", right);
      refs.more.type = "button";
      refs.more.innerHTML = svg('<path d="M3 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3m5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3"/>');
      refs.more.setAttribute("aria-haspopup", "true");
      refs.more.addEventListener("click", (event) => {
        event.stopPropagation();
        this.menuOpen = !this.menuOpen;
        this.syncMenu();
      });
      refs.menu = el("div", "jtt-menu", root);
      refs.menu.setAttribute("role", "menu");
      const menuItem = (name, path) => {
        const btn = button(refs.menu, name, `${svg(path)}<span class="jtt-menu-label"></span>`);
        btn.setAttribute("role", "menuitemcheckbox");
        btn.addEventListener("click", () => {
          this.menuOpen = false;
          this.syncMenu();
        });
      };
      menuItem("whatIf", '<path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>');
      menuItem("week", '<path d="M1 11a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1zm5-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/>');
      menuItem("history", '<path fill-rule="evenodd" d="M0 0h1v15h15v1H0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07"/>');
      menuItem("records", '<path d="M2.5.5A.5.5 0 0 1 3 0h10a.5.5 0 0 1 .5.5q0 .807-.034 1.536a3 3 0 1 1-1.133 5.89c-.79 1.865-1.878 2.777-2.833 3.011v2.173l1.425.356c.194.048.377.135.537.255L13.3 15.1a.5.5 0 0 1-.3.9H3a.5.5 0 0 1-.3-.9l1.838-1.379c.16-.12.343-.207.537-.255L6.5 13.11v-2.173c-.955-.234-2.043-1.146-2.833-3.012a3 3 0 1 1-1.132-5.89A33 33 0 0 1 2.5.5m.099 2.54a2 2 0 0 0 .72 3.935c-.333-1.05-.588-2.346-.72-3.935m10.083 3.935a2 2 0 0 0 .72-3.935c-.133 1.59-.388 2.885-.72 3.935"/>');
      menuItem("goal", '<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="M8 13A5 5 0 1 1 8 3a5 5 0 0 1 0 10m0 1A6 6 0 1 0 8 2a6 6 0 0 0 0 12"/><path d="M8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6m0 1a4 4 0 1 0 0-8 4 4 0 0 0 0 8"/><path d="M9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>');
      document.addEventListener("click", (event) => {
        if (this.menuOpen && !refs.menu.contains(event.target)) {
          this.menuOpen = false;
          this.syncMenu();
        }
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.menuOpen) {
          this.menuOpen = false;
          this.syncMenu();
          refs.more.focus();
        }
      });
      button(
        right,
        "help",
        svg('<path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286m1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94"/>'),
      );
      button(
        right,
        "dark",
        svg('<path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/>'),
      );

      refs.title = el("div", "jtt-title", root);
      refs.chip = el("span", "jtt-chip", el("div", "jtt-chip-wrap", root));
      refs.school = el("div", "jtt-school", root);
      refs.schoolLine = el("div", "jtt-school-line", refs.school);
      refs.schoolNote = el("div", "jtt-school-note", refs.school);
      // Help: short explanation of everything in the block
      refs.help = el("div", "jtt-help", root);
      refs.helpTitle = el("div", "jtt-caption jtt-caption-center", refs.help);
      refs.helpList = el("dl", "jtt-help-list", refs.help);
      refs.clockOut = el("div", "jtt-clockout", root);
      refs.clockOut.setAttribute("role", "alert");

      refs.pause = el("div", "jtt-pause", root);
      refs.pauseLine = el("div", "jtt-pause-line", refs.pause);
      refs.pauseGoal = el("div", "jtt-pause-goal", refs.pause);

      const stats = el("div", "jtt-stats", root);
      for (const name of ["spent", "toGo", "home"]) {
        const stat = el("div", "jtt-stat", stats);
        refs[`${name}Value`] = el("div", "jtt-value", stat);
        refs[`${name}Label`] = el("div", "jtt-label", stat);
      }

      const bar = el("div", "jtt-bar", root);
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      refs.bar = bar;
      refs.fill = el("div", "jtt-fill", bar);
      refs.fillAbsence = el("div", "jtt-fill jtt-fill-absence", bar);
      refs.fillOver = el("div", "jtt-fill jtt-fill-over", bar);

      const meta = el("div", "jtt-meta", root);
      refs.breakWin = el("div", "jtt-breakwin", root);
      refs.goalLine = el("div", "jtt-goalline", root);
      refs.percent = el("strong", "", el("span", "", meta));
      const breakWrap = el("span", "", meta);
      refs.breakLabel = el("span", "", breakWrap);
      refs.breakValue = el("strong", "", breakWrap);
      refs.absenceWrap = el("span", "jtt-meta-absence", meta);
      refs.absenceLabel = el("span", "", refs.absenceWrap);
      refs.absenceValue = el("strong", "", refs.absenceWrap);
      refs.overWrap = el("span", "jtt-meta-over", meta);
      refs.overLabel = el("span", "", refs.overWrap);
      refs.overValue = el("strong", "", refs.overWrap);

      // Plan: leave at, lunch break, balance goal
      const whatIf = el("div", "jtt-whatif jtt-section", root);
      refs.whatIf = whatIf;
      refs.planTitle = el("div", "jtt-caption jtt-caption-center", whatIf);
      const input = (parent, type, className = "") => {
        const field = el("input", `jtt-whatif-input ${className}`.trim(), parent);
        field.type = type;
        return field;
      };
      // Only the field that changed is taken over; inputs of a closed section may still be empty.
      const planChanged = (event) => {
        const field = event.target;
        const key = field.dataset.planKey;
        if (!key) return;
        this.plan = { ...this.plan, [key]: field.type === "checkbox" ? field.checked : field.value };
        if (this.onPlanChange) this.onPlanChange(this.plan);
      };

      const leaveBlock = el("div", "jtt-plan-block", whatIf);
      const whatIfRow = el("div", "jtt-whatif-row", leaveBlock);
      refs.whatIfBefore = el("span", "", whatIfRow);
      refs.whatIfInput = input(whatIfRow, "time");
      refs.whatIfAfter = el("span", "", whatIfRow);
      refs.whatIfResult = el("div", "jtt-whatif-result", leaveBlock);
      refs.whatIfBalance = el("div", "jtt-whatif-balance", leaveBlock);

      const lunchBlock = el("div", "jtt-plan-block", whatIf);
      const lunchRow = el("div", "jtt-whatif-row", lunchBlock);
      refs.lunchBefore = el("span", "", lunchRow);
      refs.lunchAt = input(lunchRow, "time");
      refs.lunchMiddle = el("span", "", lunchRow);
      refs.lunchMin = input(lunchRow, "number", "jtt-short");
      refs.lunchMin.min = "0";
      refs.lunchMin.max = "180";
      refs.lunchMin.step = "5";
      refs.lunchAfter = el("span", "", lunchRow);
      refs.lunchResult = el("div", "jtt-whatif-result", lunchBlock);
      refs.lunchNote = el("div", "jtt-whatif-balance", lunchBlock);

      refs.whatIfInput.dataset.planKey = "leave";
      refs.lunchAt.dataset.planKey = "lunchAt";
      refs.lunchMin.dataset.planKey = "lunchMin";
      for (const field of [refs.whatIfInput, refs.lunchAt, refs.lunchMin]) {
        field.addEventListener("input", planChanged);
      }

      // Time balance history, with today-vs-normal on top
      refs.history = el("div", "jtt-section", root);
      const rangeWrap = el("div", "jtt-range-wrap", refs.history);
      refs.rangeLabel = el("span", "jtt-range-label", rangeWrap);
      const rangeRow = el("div", "jtt-range", rangeWrap);
      refs.rangeButtons = ["three", "week", "month", "max"].map((range) => {
        const btn = el("button", "jtt-range-btn", rangeRow);
        btn.type = "button";
        btn.dataset.range = range;
        btn.addEventListener("click", () => this.onAction && this.onAction(`range-${range}`));
        return btn;
      });
      const dayHead = el("div", "jtt-section-head", refs.history);
      refs.dayTitle = el("span", "jtt-caption", dayHead);
      refs.daySum = el("span", "jtt-section-sum", dayHead);
      refs.dayChart = el("div", "jtt-day-chart", refs.history);
      refs.dayLegend = el("div", "jtt-day-legend", refs.history);
      refs.dayNote = el("div", "jtt-week-hint", refs.history);
      // Records: own section, opened from the menu
      refs.records = el("div", "jtt-section jtt-records", root);
      refs.recordsTitle = el("div", "jtt-caption jtt-caption-center", refs.records);
      const recordTiles = el("div", "jtt-balances", refs.records);
      for (const name of ["Earliest", "Longest", "Streak"]) {
        const tile = el("div", "jtt-balance", recordTiles);
        refs[`rec${name}Value`] = el("div", "jtt-balance-value", tile);
        refs[`rec${name}Label`] = el("div", "jtt-balance-label", tile);
        refs[`rec${name}Sub`] = el("div", "jtt-balance-label", tile);
      }
      el("div", "jtt-history-gap", refs.history);
      const historyHead = el("div", "jtt-section-head", refs.history);
      refs.historyTitle = el("span", "jtt-caption", historyHead);
      refs.historySum = el("span", "jtt-section-sum", historyHead);
      refs.historyChart = el("div", "jtt-history-chart", refs.history);
      refs.historyNote = el("div", "jtt-week-hint", refs.history);

      // Balance goal
      refs.goal = el("div", "jtt-section jtt-whatif", root);
      refs.goalTitle = el("div", "jtt-caption jtt-caption-center", refs.goal);
      // On/off for the balance goal; off hides the daily "today +0:20" line as well.
      const goalToggle = el("label", "jtt-toggle", refs.goal);
      refs.goalActive = el("input", "", goalToggle);
      refs.goalActive.type = "checkbox";
      refs.goalActive.checked = true;
      el("span", "jtt-toggle-track", goalToggle);
      refs.goalActiveLabel = el("span", "jtt-toggle-label", goalToggle);
      refs.goalActive.addEventListener("change", planChanged);
      const goalBlock = el("div", "jtt-plan-block", refs.goal);
      refs.goalBlock = goalBlock;
      const goalRow = el("div", "jtt-whatif-row", goalBlock);
      refs.goalBefore = el("span", "", goalRow);
      refs.goalInput = input(goalRow, "text", "jtt-short");
      refs.goalInput.placeholder = "0:00";
      refs.goalInput.inputMode = "numeric";
      refs.goalMiddle = el("span", "", goalRow);
      refs.goalDate = input(goalRow, "date");
      refs.goalResult = el("div", "jtt-whatif-result", goalBlock);
      refs.goalNote = el("div", "jtt-whatif-balance", goalBlock);

      refs.goalInput.dataset.planKey = "goal";
      refs.goalDate.dataset.planKey = "goalDate";
      refs.goalActive.dataset.planKey = "goalActive";
      for (const field of [refs.goalInput, refs.goalDate]) field.addEventListener("input", planChanged);

      // Week
      refs.week = el("div", "jtt-section", root);
      const weekHead = el("div", "jtt-section-head", refs.week);
      refs.weekTitle = el("span", "jtt-caption", weekHead);
      refs.weekSum = el("span", "jtt-section-sum", weekHead);
      const weekGrid = el("div", "jtt-week", refs.week);
      refs.weekCols = [];
      for (let i = 0; i < 5; i++) {
        const col = el("div", "jtt-day", weekGrid);
        const track = el("div", "jtt-day-track", col);
        const entry = { root: col };
        entry.over = el("div", "jtt-day-fill jtt-day-over", track);
        entry.absence = el("div", "jtt-day-fill jtt-day-absence", track);
        entry.work = el("div", "jtt-day-fill", track);
        entry.label = el("div", "jtt-day-label", col);
        entry.value = el("div", "jtt-day-value", col);
        refs.weekCols.push(entry);
      }
      refs.weekHint = el("div", "jtt-week-hint", refs.week);

      // Balances
      refs.balances = el("div", "jtt-section", root);
      refs.balancesTitle = el("div", "jtt-caption jtt-caption-center", refs.balances);
      const tiles = el("div", "jtt-balances", refs.balances);
      for (const name of ["time", "timeToday", "vacation"]) {
        const row = el("div", "jtt-balance", tiles);
        refs[`${name}Row`] = row;
        refs[`${name}Value`] = el("div", "jtt-balance-value", row);
        refs[`${name}Label`] = el("div", "jtt-balance-label", row);
        refs[`${name}Sub`] = el("div", "jtt-balance-label", row);
      }

      refs.ok = el("div", "jtt-ok", root);
      refs.ok.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/><path d="m10.97 4.97-.02.022-3.473 4.425-2.093-2.094a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05"/></svg>';
      refs.okText = el("span", "", refs.ok);

      anchor.parentElement.insertBefore(root, anchor);
      this.root = root;
    }
  }

  // ---------------------------------------------------------------- alerts

  class AlertList {
    constructor() {
      this.signature = "";
    }

    /** `alerts` are { type, text }. Only touches the page when something changed. */
    update(alerts) {
      const existing = document.querySelector(".jtt-alerts");
      const theme = pageTheme();
      const signature = theme + "|" + alerts.map((a) => `${a.type}:${a.text}`).join("|");
      if (existing && signature === this.signature) return;
      if (existing) existing.remove();
      this.signature = signature;
      if (alerts.length === 0) return;

      const anchor = document.querySelector(".stempel-data");
      if (!anchor || !anchor.parentElement) return;
      const list = document.createElement("div");
      list.className = "jtt-alerts";
      list.setAttribute("data-jazz-extension", "");
      list.dataset.jttTheme = theme;
      for (const alert of alerts) {
        const item = document.createElement("div");
        item.className = "jtt-alert";
        item.dataset.type = alert.type;
        item.setAttribute("role", alert.type === "violation" ? "alert" : "status");
        item.innerHTML = ICONS[alert.type] || ICONS.warning;
        const text = document.createElement("span");
        text.textContent = alert.text;
        item.appendChild(text);
        list.appendChild(item);
      }
      anchor.parentElement.insertBefore(list, anchor);
    }

    clear() {
      this.signature = "";
      const existing = document.querySelector(".jtt-alerts");
      if (existing) existing.remove();
    }
  }

  // ------------------------------------------------------------- controller

  class JazzTimeTracker {
    constructor() {
      this.reader = new TimeReader();
      this.panel = new DayPanel();
      this.alerts = new AlertList();
      this.settingsManager = new SettingsManager();
      this.settings = null;
      this.lastLiveKey = "";
      this.lastLiveWrite = 0;
      this.lastScheduleKey = "";
      this.notified = null; // { date, keys: [] }
      this.look = new PageLook();
      this.open = { whatIf: false, week: false, goal: false, history: false };
      this.history = {}; // "YYYY-MM-DD" -> time balance in minutes, as Jazz reported it
      this.days = {}; // "YYYY-MM-DD" -> that day's stamps
      try {
        chrome.storage.local.get({ jttDays: {} }, (items) => {
          this.days = { ...items.jttDays, ...this.days };
          this.daysLoaded = true;
        });
      } catch (err) {
        /* extension reloaded */
      }
      try {
        chrome.storage.local.get({ jttSaldoHistory: {} }, (items) => {
          this.history = { ...items.jttSaldoHistory, ...this.history };
          this.historyLoaded = true;
        });
      } catch (err) {
        /* extension reloaded */
      }
      try {
        chrome.storage.local.get({ jttOpen: this.open }, (items) => {
          this.open = {
            whatIf: Boolean(items.jttOpen.whatIf),
            week: Boolean(items.jttOpen.week),
            goal: Boolean(items.jttOpen.goal),
            history: Boolean(items.jttOpen.history),
            records: Boolean(items.jttOpen.records),
            help: Boolean(items.jttOpen.help),
            range: ["three", "week", "month", "max"].includes(items.jttOpen.range) ? items.jttOpen.range : "week",
          };
        });
      } catch (err) {
        /* extension reloaded */
      }
      this.panel.onAction = (name) => this.handleAction(name);
      try {
        chrome.storage.local.get({ jttPlan: null, jttWhatIf: null }, (items) => {
          const stored = items.jttPlan || (items.jttWhatIf ? { leave: items.jttWhatIf } : {});
          this.panel.plan = { ...DEFAULT_PLAN, ...stored };
        });
        // Lets the keyboard shortcut open exactly this page later.
        chrome.storage.local.set({ jttStampUrl: window.location.href });
      } catch (err) {
        /* extension reloaded */
      }
      this.panel.onPlanChange = (plan) => {
        try {
          chrome.storage.local.set({ jttPlan: plan });
        } catch (err) {
          /* extension reloaded */
        }
      };
      this.titleOriginal = null;
      this.titleSet = null;
      this.lastBreakKey = "";
      this.loadSettings();
      this.settingsManager.addChangeListener(() => this.loadSettings());
    }

    /** Buttons at the top of the status block. */
    async handleAction(name) {
      try {
        if (name === "lang-de" || name === "lang-en") {
          await this.settingsManager.saveSettings({ language: name === "lang-de" ? "de" : "en" });
        } else if (name === "dark") {
          await this.settingsManager.saveSettings({ theme: this.settings.theme === "dark" ? "light" : "dark" });
        } else if (name.startsWith("range-")) {
          this.open = { ...this.open, range: name.slice(6) };
          chrome.storage.local.set({ jttOpen: this.open });
        } else if (name === "whatIf" || name === "week" || name === "goal" || name === "history" || name === "records" || name === "help") {
          this.open = { ...this.open, [name]: !this.open[name] };
          chrome.storage.local.set({ jttOpen: this.open });
        }
        await this.loadSettings();
        this.updateDisplay();
      } catch (err) {
        /* extension reloaded */
      }
    }

    async loadSettings() {
      this.settings = await this.settingsManager.loadSettings();
      this.lastScheduleKey = ""; // re-evaluate notifications with the new settings
    }

    async updateDisplay() {
      if (!this.settings) await this.loadSettings();
      if (!document.querySelector(".stempel-data")) return;

      const settings = this.settings;
      const lang = resolveLanguage(settings.language);
      const dark = settings.theme === "dark";
      this.look.setLanguage(lang);
      this.look.setDark(dark);
      const times = this.reader.readTimes();
      const status = computeDayStatus(settings, times.checkpoints, times.absenceTime.totalMinutes);

      // Same as v2.0.0: without a stamp, the rules are checked against "now".
      const ruleCheckpoints = status.hasStamps ? times.checkpoints : [new Time().toString()];
      const rules = new ComplianceRules(settings.isApprentice, settings.showWarnings, settings.showViolations);
      const findings = rules.checkAll(ruleCheckpoints, times.previousDayEnd, times.absenceTime);
      // Only claim "all good" when the violation checks actually ran and found nothing.
      const rulesOk = status.hasStamps && settings.showViolations && findings.length === 0;
      const clockOut = mustClockOut(findings, status.clockedIn);
      const schoolDay = isSchoolToday(settings) && !status.hasStamps;
      this.panel.school = schoolDays(settings);
      const balances = this.reader.readBalances();
      this.recordBalance(balances);
      this.recordDay(times.checkpoints);
      this.panel.update({
        status,
        lang,
        settings,
        checkpoints: times.checkpoints,
        rulesOk,
        balances,
        clockOut,
        week: this.buildWeek(status, settings),
        open: this.open,
        dark,
        schoolDay,
        history: this.history,
        dayCurves:
          this.open.history || this.open.records ? this.buildDayCurves(settings, this.open.range || "week") : null,
      });
      // On a school day without stamps there is nothing to check.
      this.alerts.update(
        schoolDay ? [] : findings.map((f) => ({ type: f.type, text: translate(lang, f.key, f.params) })),
      );

      this.shareLiveStatus(times, balances);
      this.scheduleGoHome(status, settings, lang);
      this.scheduleBreakEnd(status, times.checkpoints, settings, lang);
      this.updateTabTitle(status, times.checkpoints, lang);
      this.notifyNewWarnings(findings, status, settings, lang);
    }

    /** Keeps today's stamps, so later days can compare against a normal day. */
    recordDay(checkpoints) {
      // Wait until the stored days are loaded, otherwise they would be overwritten.
      if (!this.daysLoaded || !checkpoints.length) return;
      const key = todayKey();
      if (JSON.stringify(this.days[key]) === JSON.stringify(checkpoints)) return;
      // No limit: a day is about 60 bytes, so even years of days stay far below the browser's storage limit.
      const keys = Object.keys({ ...this.days, [key]: 1 }).sort();
      const next = {};
      for (const k of keys) next[k] = k === key ? checkpoints : this.days[k];
      this.days = next;
      try {
        chrome.storage.local.set({ jttDays: next });
      } catch (err) {
        /* extension reloaded */
      }
    }

    /**
     * The past working days (Mon-Fri, not school, not today) as stamp pairs: from the days
     * the extension recorded, and from the days visible on the page: the last 3, 5 or 20,
     * or all of them, depending on the selector (3 days / week / month / max).
     * Without any, an assumed normal day: 8:00 start, 30 min break at 12:00.
     */
    buildDayCurves(settings, range = "week") {
      const school = schoolDays(settings);
      const weekdayKey = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const byDate = {};
      for (const [date, stamps] of Object.entries(this.days)) {
        const pairs = pairsFromStamps(stamps);
        if (pairs.length) byDate[date] = pairs;
      }
      for (const [date, info] of Object.entries(this.reader.readOtherDays())) {
        const [d, m, y] = date.split(".");
        const iso = `${y}-${m}-${d}`;
        if (info.pairs && info.pairs.length) byDate[iso] = info.pairs;
      }
      const today = todayKey();
      const allDates = Object.keys(byDate)
        .filter((date) => {
          if (date >= today) return false;
          const dow = new Date(`${date}T00:00:00`).getDay();
          return dow !== 0 && dow !== 6 && !school[weekdayKey[dow]];
        })
        .sort();
      const records = buildRecords(allDates, byDate, settings);
      const days = allDates.slice(-({ three: 3, week: 5, month: 20, max: Infinity }[range] || 5)).map((date) => byDate[date]);
      if (days.length) return { days, model: false, records };
      const target = targetMinutesToday(settings);
      const morning = Math.min(240, target);
      return {
        days: [[[480, 480 + morning], ...(target > morning ? [[750, 750 + target - morning]] : [])]],
        model: true,
        records,
      };
    }

    /** Remembers the time balance per day, so the history can be drawn later. */
    recordBalance(balances) {
      const time = balances && balances.time;
      if (!this.historyLoaded || !time || !time.asOf) return;
      const match = time.asOf.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      const minutes = parseSignedTime(time.value);
      if (!match || minutes === null) return;
      const key = `${match[3]}-${match[2]}-${match[1]}`;
      if (this.history[key] === minutes) return;
      const keys = Object.keys({ ...this.history, [key]: minutes }).sort();
      const next = {};
      for (const k of keys) next[k] = k === key ? minutes : this.history[k];
      this.history = next;
      try {
        chrome.storage.local.set({ jttSaldoHistory: next });
      } catch (err) {
        /* extension reloaded */
      }
    }

    /** Monday to Friday of this week: today from the live numbers, the other days from the page. */
    buildWeek(status, settings) {
      const others = this.reader.readOtherDays();
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      return DAYS.map((day, i) => {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        const cfg = (settings.dailyHours && settings.dailyHours[day]) || { hours: 8, minutes: 12 };
        const entry = {
          day,
          target: 60 * cfg.hours + cfg.minutes,
          worked: null,
          absence: 0,
          isToday: false,
          school: Boolean(schoolDays(settings)[day]),
        };
        if (todayKey(date) === todayKey(today)) {
          entry.isToday = true;
          entry.worked = Math.max(0, status.timeSpent.totalMinutes);
          entry.absence = Math.max(0, status.absence.totalMinutes);
        } else if (date < today) {
          const key = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
          if (others[key]) Object.assign(entry, others[key]);
        }
        return entry;
      });
    }

    /** Stores today's stamps so the popup can show the day without Jazz in front. */
    shareLiveStatus(times, balances) {
      const live = {
        date: todayKey(),
        checkpoints: times.checkpoints,
        absenceMinutes: times.absenceTime.totalMinutes,
        balances,
      };
      const key = JSON.stringify(live);
      const now = Date.now();
      if (key === this.lastLiveKey && now - this.lastLiveWrite < 60000) return;
      this.lastLiveKey = key;
      this.lastLiveWrite = now;
      try {
        chrome.storage.local.set({ liveStatus: { ...live, updatedAt: now } });
      } catch (err) {
        /* extension reloaded */
      }
    }

    /** Notification when the required break is complete (one alarm in the background). */
    scheduleBreakEnd(status, checkpoints, settings, lang) {
      const pause = runningBreak(status, checkpoints);
      const active = settings.notifyEnabled && pause && pause.required > 0 && pause.remaining > 0;
      if (!active) {
        if (this.lastBreakKey !== "off") {
          this.lastBreakKey = "off";
          sendToBackground({ type: "jtt-break-clear" });
        }
        return;
      }
      const key = `${todayKey()}|${pause.since.toString()}|${pause.required}|${status.breaks.totalMinutes}|${lang}`;
      if (key === this.lastBreakKey) return;
      this.lastBreakKey = key;
      const at = new Date();
      at.setHours(0, pause.since.totalMinutes + pause.required - status.breaks.totalMinutes, 0, 0);
      sendToBackground({
        type: "jtt-break",
        at: at.getTime(),
        texts: {
          title: translate(lang, "breakDoneTitle"),
          body: translate(lang, "breakDoneBody", { n: pause.required }),
        },
      });
    }

    /** "2:37 bis Feierabend – <Jazz title>" in the browser tab. */
    updateTabTitle(status, checkpoints, lang) {
      if (this.titleSet === null || document.title !== this.titleSet) this.titleOriginal = document.title;
      let prefix = "";
      const pause = runningBreak(status, checkpoints);
      if (status.clockedIn) {
        prefix = status.overtime
          ? translate(lang, "tabOvertime", { time: status.overtime.toString() })
          : translate(lang, "tabToGo", { time: status.timeToGo.toString() });
      } else if (pause) {
        prefix = translate(lang, "tabBreak", { time: new Time(pause.current).toString() });
      }
      const title = prefix ? `${prefix} \u2013 ${this.titleOriginal}` : this.titleOriginal;
      if (document.title !== title) document.title = title;
      this.titleSet = title;
    }

    restoreTitle() {
      if (this.titleSet !== null && document.title === this.titleSet) document.title = this.titleOriginal;
    }

    scheduleGoHome(status, settings, lang) {
      const active = settings.notifyEnabled && status.clockedIn && !status.overtime;
      if (!active) {
        if (this.lastScheduleKey !== "off") {
          this.lastScheduleKey = "off";
          sendToBackground({ type: "jtt-clear" });
        }
        return;
      }
      const lead = Number(settings.notifyLeadMinutes) || 10;
      const goHome = status.goHomeTime;
      const key = `${todayKey()}|${goHome.toString()}|${lead}|${lang}`;
      if (key === this.lastScheduleKey) return;
      this.lastScheduleKey = key;

      const at = new Date();
      at.setHours(0, goHome.totalMinutes, 0, 0);
      sendToBackground({
        type: "jtt-schedule",
        goHomeAt: at.getTime(),
        leadMinutes: lead,
        texts: {
          soonTitle: translate(lang, "notifySoonTitle"),
          soonBody: translate(lang, "notifySoonBody", { n: lead, time: goHome.toString() }),
          nowTitle: translate(lang, "notifyNowTitle"),
          nowBody: translate(lang, "notifyNowBody"),
        },
      });
    }

    /** One notification per warning and day, when it first comes up. */
    async notifyNewWarnings(findings, status, settings, lang) {
      if (!settings.notifyEnabled || !status.hasStamps) return;
      const warnings = findings.filter((f) => f.type === "warning");
      if (warnings.length === 0) return;

      const today = todayKey();
      if (!this.notified) {
        this.notified = { date: today, keys: [] }; // set first so parallel ticks do not double-send
        const stored = await new Promise((resolve) => {
          try {
            chrome.storage.local.get({ jttNotified: null }, (items) => resolve(items.jttNotified));
          } catch (err) {
            resolve(null);
          }
        });
        if (stored && stored.date === today) {
          this.notified.keys = [...new Set([...stored.keys, ...this.notified.keys])];
        }
      }
      if (this.notified.date !== today) this.notified = { date: today, keys: [] };

      const fresh = warnings.filter((w) => !this.notified.keys.includes(w.key));
      if (fresh.length === 0) return;
      for (const warning of fresh) {
        this.notified.keys.push(warning.key);
        sendToBackground({
          type: "jtt-notify",
          id: `jtt-warning-${warning.key}`,
          title: translate(lang, "notifyWarningTitle"),
          message: translate(lang, warning.key, warning.params),
        });
      }
      try {
        chrome.storage.local.set({ jttNotified: this.notified });
      } catch (err) {
        /* extension reloaded */
      }
    }
  }

  // ------------------------------------------------------------------ boot

  let tracker = null;
  let timer = null;
  let stylesInjected = false;

  function isStampPage() {
    return window.location.href.includes("stempel") || window.location.hash.includes("stempel");
  }

  function injectStyles() {
    if (stylesInjected) return;
    const style = document.createElement("style");
    style.setAttribute("data-jazz-extension-styles", "");
    style.textContent = STYLES;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  function sync() {
    if (isStampPage()) {
      if (tracker) return;
      injectStyles();
      tracker = new JazzTimeTracker();
      timer = setInterval(() => tracker.updateDisplay(), 1000);
    } else if (tracker) {
      clearInterval(timer);
      timer = null;
      tracker.look.reset();
      tracker.restoreTitle();
      document.querySelectorAll("[data-jazz-extension]").forEach((el) => el.remove());
      tracker = null;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", sync);
  else sync();
  window.addEventListener("hashchange", sync);

  let lastUrl = window.location.href;
  new MutationObserver(() => {
    if (lastUrl !== window.location.href) {
      lastUrl = window.location.href;
      sync();
    }
  }).observe(document, { subtree: true, childList: true });
})();
