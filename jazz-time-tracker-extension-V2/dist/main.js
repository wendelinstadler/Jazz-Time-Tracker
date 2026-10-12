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
      gap: 4px;
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
    .jtt-pause { margin-top: 8px; font-size: 13px; color: var(--jtt-muted); font-variant-numeric: tabular-nums; }
    .jtt-pause[hidden], .jtt-pause-goal[hidden] { display: none; }
    .jtt-pause-line { color: inherit; }
    .jtt-pause-goal[data-done="true"] { color: var(--jtt-accent-text); }
    .jtt-whatif { margin-top: 20px; font-size: 14px; }
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
    .jtt-whatif-result { min-width: 3.2em; text-align: left; font-size: 18px; font-weight: bolder; font-variant-numeric: tabular-nums; }
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
      if (dark && !this.darkStyle) {
        const style = document.createElement("style");
        style.setAttribute("data-jazz-extension-dark", "");
        style.textContent = `
          html { background: #ffffff !important; filter: invert(0.92) hue-rotate(180deg); }
          html img, html video, html picture { filter: invert(1) hue-rotate(180deg); }
        `;
        document.head.appendChild(style);
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
        days[date[1]] = { worked: worked + absence, absence };
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

  class DayPanel {
    constructor() {
      this.root = null;
      this.refs = {};
      this.whatIf = "17:00";
      this.onWhatIfChange = null;
      this.onAction = null; // called with "lang-de", "lang-en", "whatIf", "week" or "dark"
    }

    update({ status, lang, settings, checkpoints, rulesOk, balances, clockOut, week, open, dark }) {
      const anchor = document.querySelector(".stempel-data");
      if (!anchor || !anchor.parentElement) return;
      if (!this.root || !this.root.isConnected) this.create(anchor);

      const t = (key, params) => translate(lang, key, params);
      const over = Boolean(status.overtime);
      const { refs } = this;

      this.root.dataset.jttTheme = pageTheme();
      this.root.dataset.over = String(over);
      refs.title.textContent = t("panelTitle");

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

      // Tool buttons
      const pressed = { "lang-de": lang === "de", "lang-en": lang === "en", whatIf: open.whatIf, week: open.week, dark };
      const labels = {
        "lang-de": "Deutsch",
        "lang-en": "English",
        whatIf: t("toolWhatIf"),
        week: t("toolWeek"),
        dark: t("toolDark"),
      };
      for (const name of Object.keys(pressed)) {
        const btn = refs[`btn_${name}`];
        btn.setAttribute("aria-pressed", String(Boolean(pressed[name])));
        btn.title = labels[name];
        btn.setAttribute("aria-label", labels[name]);
      }

      refs.whatIf.hidden = !open.whatIf;
      if (open.whatIf) this.updateWhatIf(status, balances, t);
      this.updateWeek(open.week ? week : null, t);
      this.updateBalances(status, balances, t);

      refs.ok.hidden = !rulesOk;
      refs.okText.textContent = t("rulesOk");
    }

    /** "If I leave at 16:30": plus or minus for today, and the balance that results. */
    updateWhatIf(status, balances, t) {
      const { refs } = this;
      refs.whatIfBefore.textContent = t("whatIfBefore");
      refs.whatIfAfter.textContent = t("whatIfAfter");
      refs.whatIfInput.setAttribute("aria-label", `${t("whatIfBefore")} … ${t("whatIfAfter")}`.trim());
      if (document.activeElement !== refs.whatIfInput && refs.whatIfInput.value !== this.whatIf) {
        refs.whatIfInput.value = this.whatIf;
      }
      const leave = parseSignedTime(refs.whatIfInput.value || "");
      if (leave === null) {
        refs.whatIfResult.textContent = "–";
        refs.whatIfResult.dataset.sign = "";
        refs.whatIfBalance.hidden = true;
        return;
      }
      const diff = leaveAtDifference(status, leave);
      refs.whatIfResult.textContent = formatSigned(diff);
      refs.whatIfResult.dataset.sign = diff < 0 ? "minus" : "plus";

      const base = balances && balances.time ? parseSignedTime(balances.time.value) : null;
      const withToday = timeBalanceWithToday(balances, status);
      refs.whatIfBalance.hidden = base === null || withToday === null;
      if (base !== null && withToday !== null) {
        refs.whatIfBalance.textContent = t("whatIfBalance", { value: formatSigned(base + diff) });
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
    }

    updateBalances(status, balances, t) {
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
      const withToday = timeBalanceWithToday(balances, status);
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
      button(
        right,
        "whatIf",
        svg('<path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z"/><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0"/>'),
      );
      button(
        right,
        "week",
        svg('<path d="M1 11a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1zm5-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z"/>'),
      );
      button(
        right,
        "dark",
        svg('<path d="M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278"/>'),
      );

      refs.title = el("div", "jtt-title", root);
      refs.chip = el("span", "jtt-chip", el("div", "", root));
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

      // What if I leave at ...
      const whatIf = el("div", "jtt-whatif", root);
      refs.whatIf = whatIf;
      const whatIfRow = el("div", "jtt-whatif-row", whatIf);
      refs.whatIfBefore = el("span", "", whatIfRow);
      refs.whatIfInput = el("input", "jtt-whatif-input", whatIfRow);
      refs.whatIfInput.type = "time";
      refs.whatIfInput.value = this.whatIf;
      refs.whatIfAfter = el("span", "", whatIfRow);
      refs.whatIfResult = el("strong", "jtt-whatif-result", whatIfRow);
      refs.whatIfBalance = el("div", "jtt-whatif-balance", whatIf);
      refs.whatIfInput.addEventListener("input", () => {
        this.whatIf = refs.whatIfInput.value;
        if (this.onWhatIfChange) this.onWhatIfChange(this.whatIf);
      });

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
      this.open = { whatIf: false, week: false };
      try {
        chrome.storage.local.get({ jttOpen: this.open }, (items) => {
          this.open = { whatIf: Boolean(items.jttOpen.whatIf), week: Boolean(items.jttOpen.week) };
        });
      } catch (err) {
        /* extension reloaded */
      }
      this.panel.onAction = (name) => this.handleAction(name);
      try {
        chrome.storage.local.get({ jttWhatIf: "17:00" }, (items) => {
          this.panel.whatIf = items.jttWhatIf;
        });
      } catch (err) {
        /* extension reloaded */
      }
      this.panel.onWhatIfChange = (value) => {
        try {
          chrome.storage.local.set({ jttWhatIf: value });
        } catch (err) {
          /* extension reloaded */
        }
      };
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
        } else if (name === "whatIf" || name === "week") {
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
      const balances = this.reader.readBalances();
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
      });
      this.alerts.update(findings.map((f) => ({ type: f.type, text: translate(lang, f.key, f.params) })));

      this.shareLiveStatus(times, balances);
      this.scheduleGoHome(status, settings, lang);
      this.notifyNewWarnings(findings, status, settings, lang);
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
        const entry = { day, target: 60 * cfg.hours + cfg.minutes, worked: null, absence: 0, isToday: false };
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
