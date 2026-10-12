/*
 * Jazz Time Tracker – shared core
 * Time maths, work time rules, settings and translations.
 * Loaded by the content script and by the popup.
 *
 * The calculation and rule logic is unchanged from v2.0.0 (Lorenz Boss).
 * Rules now return a message key plus parameters instead of English text,
 * so they can be shown in German or English.
 */
(() => {
  "use strict";

  const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

  // ---------------------------------------------------------------- settings

  const DEFAULT_SETTINGS = {
    isApprentice: true,
    showWarnings: true,
    showViolations: true,
    notifyEnabled: true,
    notifyLeadMinutes: 10,
    language: "auto",
    theme: "light",
    dailyHours: {
      monday: { hours: 8, minutes: 12 },
      tuesday: { hours: 8, minutes: 12 },
      wednesday: { hours: 8, minutes: 12 },
      thursday: { hours: 8, minutes: 12 },
      friday: { hours: 8, minutes: 12 },
    },
  };

  const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

  class SettingsManager {
    constructor() {
      this.defaultSettings = DEFAULT_SETTINGS;
    }

    async loadSettings() {
      try {
        return await new Promise((resolve) => {
          chrome.storage.local.get(this.defaultSettings, (items) => resolve(items));
        });
      } catch (err) {
        console.warn("Chrome storage not available, using defaults:", err);
        return this.defaultSettings;
      }
    }

    async saveSettings(settings) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(settings, () => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve();
        });
      });
    }

    /** Calls back whenever one of the settings (not the live data) changes. */
    addChangeListener(callback) {
      if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.onChanged) return;
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;
        if (SETTING_KEYS.some((key) => key in changes)) callback(changes);
      });
    }
  }

  // -------------------------------------------------------------------- time

  /** A duration or a time of day, stored as minutes. */
  class Time {
    constructor(totalMinutes = null) {
      if (totalMinutes !== null) {
        this.totalMinutes = totalMinutes;
      } else {
        const now = new Date();
        this.totalMinutes = 60 * now.getHours() + now.getMinutes();
      }
    }

    get hours() {
      return Math.floor(Math.abs(this.totalMinutes) / 60);
    }
    get minutes() {
      return Math.abs(this.totalMinutes) % 60;
    }
    get isNegative() {
      return this.totalMinutes < 0;
    }

    static of(hours, minutes = 0) {
      return new Time(60 * hours + minutes);
    }

    static from(value) {
      if (value instanceof Time) return value;
      const text = value.trim();
      const negative = text.startsWith("-");
      const body = negative ? text.substring(1) : text;
      const [h, m = 0] = body.split(":").map((part) => parseInt(part));
      const total = 60 * h + m;
      return new Time(negative ? -total : total);
    }

    add(other) {
      return new Time(this.totalMinutes + this.normalize(other).totalMinutes);
    }
    sub(other) {
      return new Time(this.totalMinutes - this.normalize(other).totalMinutes);
    }
    diff(other) {
      return new Time(Math.abs(this.totalMinutes - this.normalize(other).totalMinutes));
    }
    compare(other) {
      const o = this.normalize(other);
      return this.totalMinutes > o.totalMinutes ? 1 : this.totalMinutes < o.totalMinutes ? -1 : 0;
    }

    toString() {
      return `${this.isNegative ? "-" : ""}${this.hours}:${String(this.minutes).padStart(2, "0")}`;
    }

    normalize(value) {
      if (value instanceof Time) return value;
      if (typeof value === "number") return new Time(value);
      if (typeof value === "string") return Time.from(value);
      throw new Error("Invalid argument type");
    }
  }

  // -------------------------------------------------------------- calculator

  class TimeCalculator {
    constructor(minimumBreak, minimumWorkday) {
      this.minimumBreak = minimumBreak;
      this.minimumWorkday = minimumWorkday;
    }

    /** Sorted checkpoints; if still clocked in, "now" is appended as the open end. */
    getExtendedCheckpoints(checkpoints) {
      if (!checkpoints || checkpoints.length === 0) return checkpoints;
      const sorted = [...checkpoints].sort((a, b) => Time.from(a).compare(Time.from(b)));
      return sorted.length % 2 === 1 ? [...sorted, new Time().toString()] : sorted;
    }

    breaks(checkpoints) {
      const cps = this.getExtendedCheckpoints(checkpoints);
      if (cps.length < 2) return new Time(0);
      let total = new Time(0);
      let lastOut = null;
      for (let i = 1; i < cps.length; i++) {
        if (i % 2 === 1) lastOut = Time.from(cps[i]);
        else total = total.add(lastOut.diff(Time.from(cps[i])));
      }
      return total;
    }

    timeSpent(checkpoints, absence = new Time(0)) {
      const cps = this.getExtendedCheckpoints(checkpoints);
      if (cps.length === 0) return absence;
      return Time.from(cps[0])
        .diff(Time.from(cps[cps.length - 1]))
        .diff(this.breaks(checkpoints))
        .add(absence);
    }

    timeToGo(checkpoints, absence = new Time(0)) {
      const breaks = this.breaks(checkpoints);
      const spent = this.timeSpent(checkpoints, absence);
      return this.minimumBreak.compare(breaks) === 1
        ? this.minimumWorkday.add(this.minimumBreak).sub(spent)
        : this.minimumWorkday.sub(spent);
    }

    goTime(checkpoints, absence = new Time(0)) {
      return new Time().add(this.timeToGo(checkpoints, absence));
    }
  }

  /** Groups work periods into blocks that are not interrupted by a break of at least `minBreak`. */
  function continuousBlocks(cps, minBreak) {
    const blocks = [];
    if (cps.length < 2) return blocks;
    let blockStart = Time.from(cps[0]);
    let periods = [{ start: Time.from(cps[0]), end: Time.from(cps[1]) }];
    for (let i = 2; i < cps.length; i += 2) {
      if (i + 1 < cps.length) {
        const prevEnd = Time.from(cps[i - 1]);
        const gap = Time.from(cps[i]).diff(prevEnd);
        const start = Time.from(cps[i]);
        const end = Time.from(cps[i + 1]);
        if (gap.compare(minBreak) >= 0) {
          blocks.push({
            start: blockStart,
            end: periods[periods.length - 1].end,
            duration: sumPeriods(periods),
            workPeriods: [...periods],
          });
          blockStart = start;
          periods = [{ start, end }];
        } else {
          periods.push({ start, end });
        }
      }
    }
    if (periods.length > 0) {
      blocks.push({
        start: blockStart,
        end: periods[periods.length - 1].end,
        duration: sumPeriods(periods),
        workPeriods: [...periods],
      });
    }
    return blocks;
  }

  function sumPeriods(periods) {
    let total = new Time(0);
    for (const p of periods) total = total.add(p.end.diff(p.start));
    return total;
  }

  function isClockedIn(checkpoints) {
    return checkpoints.length % 2 === 1;
  }

  function workSpan(cps) {
    if (cps.length === 0) return null;
    const start = Time.from(cps[0]);
    const end = Time.from(cps[cps.length - 1]);
    return { start, end, duration: end.sub(start) };
  }

  // ------------------------------------------------------------------- rules

  class ComplianceRules {
    constructor(isApprentice, showWarnings = true, showViolations = true) {
      this.isApprentice = isApprentice;
      this.showWarnings = showWarnings;
      this.showViolations = showViolations;
      this.timeCalculator = new TimeCalculator(new Time(0), new Time(0));
    }

    /** Returns a list of { type: "warning" | "violation", key, params }. */
    checkAll(checkpoints, previousDayEnd = null, absence = null) {
      const out = [];
      if (!checkpoints || checkpoints.length === 0) return out;
      const cps = this.timeCalculator.getExtendedCheckpoints(checkpoints);
      const spent = this.timeCalculator.timeSpent(checkpoints);
      const breaks = this.timeCalculator.breaks(checkpoints);
      if (this.showWarnings) {
        out.push(...this.checkApprenticeStartTimeWarning(cps, absence));
        out.push(...this.checkContinuousWorkWarnings(cps, checkpoints));
        out.push(...this.checkPreventiveWarnings(spent, breaks, cps, checkpoints));
      }
      if (this.showViolations) {
        out.push(...this.checkMaxDailyHours(spent));
        out.push(...this.checkContinuousWorkPeriods(cps));
        out.push(...this.checkMandatoryBreaks(spent, breaks));
        out.push(...this.checkWorkingHoursViolations(cps));
        out.push(...this.checkWorkSpanViolations(cps));
        out.push(...this.checkRestPeriod(previousDayEnd, cps));
      }
      return out;
    }

    checkApprenticeStartTimeWarning(cps, absence = null) {
      const out = [];
      if (!this.isApprentice || cps.length === 0) return out;
      if (absence && absence.totalMinutes > 0) return out;
      const start = Time.from(cps[0]);
      if (start.compare(Time.of(9)) > 0) {
        out.push({ type: "warning", key: "lateStart", params: { start: start.toString() } });
      }
      return out;
    }

    checkContinuousWorkWarnings(cps, checkpoints) {
      const out = [];
      if (cps.length < 2) return out;
      if (!isClockedIn(checkpoints)) return out;
      const blocks15 = continuousBlocks(cps, Time.of(0, 15));
      const blocks30 = continuousBlocks(cps, Time.of(0, 30));
      if (blocks15.length > 0) {
        const b = blocks15[blocks15.length - 1];
        if (b.duration.compare(Time.of(5)) >= 0 && b.duration.compare(Time.of(5, 30)) <= 0) {
          out.push({
            type: "warning",
            key: "break15Soon",
            params: {
              duration: b.duration.toString(),
              since: b.start.toString(),
              minutes: Time.of(5, 30).sub(b.duration).totalMinutes,
            },
          });
        }
      }
      if (blocks30.length > 0) {
        const b = blocks30[blocks30.length - 1];
        if (b.duration.compare(Time.of(6, 30)) >= 0 && b.duration.compare(Time.of(7)) <= 0) {
          out.push({
            type: "warning",
            key: "break30Soon",
            params: {
              duration: b.duration.toString(),
              since: b.start.toString(),
              minutes: Time.of(7).sub(b.duration).totalMinutes,
            },
          });
        }
      }
      return out;
    }

    checkPreventiveWarnings(spent, breaks, cps, checkpoints) {
      const out = [];
      if (!isClockedIn(checkpoints)) return out;

      const limit = Time.of(this.isApprentice ? 9 : 10);
      const limitSoon = limit.sub(Time.of(0, 30));
      if (spent.compare(limitSoon) >= 0 && spent.compare(limit) <= 0) {
        out.push({
          type: "warning",
          key: this.isApprentice ? "dailyLimitSoonApprentice" : "dailyLimitSoon",
          params: { minutes: limit.sub(spent).totalMinutes, limit: limit.hours },
        });
      }

      if (!this.isApprentice && spent.compare(Time.of(10)) > 0 && spent.compare(Time.of(12, 30)) <= 0) {
        out.push({ type: "warning", key: "over10h", params: { spent: spent.toString() } });
      }

      if (spent.compare(Time.of(8, 30)) >= 0 && spent.compare(Time.of(9)) <= 0 && breaks.compare(Time.of(1)) < 0) {
        out.push({
          type: "warning",
          key: "break60Soon",
          params: {
            minutes: Time.of(9).sub(spent).totalMinutes,
            missing: Time.of(1).sub(breaks).totalMinutes,
          },
        });
      }

      const span = workSpan(cps);
      if (span) {
        const maxSpan = this.isApprentice ? 12 : 14;
        const max = Time.of(maxSpan);
        const soon = Time.of(maxSpan - 0.5);
        if (span.duration.compare(soon) >= 0 && span.duration.compare(max) <= 0) {
          out.push({
            type: "warning",
            key: "spanSoon",
            params: {
              span: span.duration.toString(),
              minutes: max.sub(span.duration).totalMinutes,
              limit: maxSpan,
            },
          });
        }
      }

      const now = new Time();
      if (now.compare(Time.of(19, 30)) >= 0 && now.compare(Time.of(20)) <= 0) {
        out.push({ type: "warning", key: "stopBy20", params: { minutes: Time.of(20).sub(now).totalMinutes } });
      }
      return out;
    }

    checkMaxDailyHours(spent) {
      const out = [];
      const max = Time.of(this.isApprentice ? 9 : 12.5);
      if (spent.compare(max) > 0) {
        out.push({ type: "violation", key: "maxDaily", params: { spent: spent.toString(), limit: max.toString() } });
      }
      return out;
    }

    checkContinuousWorkPeriods(cps) {
      const out = [];
      if (cps.length < 2) return out;
      // `ongoing` marks the block that is still running (the last one), as opposed to one earlier today.
      const blocks15 = continuousBlocks(cps, Time.of(0, 15));
      blocks15.forEach((b, i) => {
        if (b.duration.compare(Time.of(5, 30)) > 0) {
          out.push({
            type: "violation",
            key: "noBreak15",
            params: { duration: b.duration.toString(), from: b.start.toString(), to: b.end.toString() },
            ongoing: i === blocks15.length - 1,
          });
        }
      });
      const blocks30 = continuousBlocks(cps, Time.of(0, 30));
      blocks30.forEach((b, i) => {
        if (b.duration.compare(Time.of(7)) > 0) {
          out.push({
            type: "violation",
            key: "noBreak30",
            params: { duration: b.duration.toString(), from: b.start.toString(), to: b.end.toString() },
            ongoing: i === blocks30.length - 1,
          });
        }
      });
      return out;
    }

    checkMandatoryBreaks(spent, breaks) {
      const out = [];
      if (spent.compare(Time.of(9)) > 0 && breaks.compare(Time.of(1)) < 0) {
        out.push({
          type: "violation",
          key: "break60Missing",
          params: { taken: breaks.totalMinutes, required: Time.of(1).totalMinutes },
          ongoing: true,
        });
      }
      return out;
    }

    checkWorkingHoursViolations(cps) {
      const out = [];
      const span = workSpan(cps);
      if (!span) return out;
      if (span.start.compare(Time.of(6)) < 0) {
        out.push({ type: "violation", key: "before6", params: { start: span.start.toString() } });
      }
      if (span.end.compare(Time.of(20)) > 0) {
        out.push({ type: "violation", key: "after20", params: { end: span.end.toString() } });
      }
      return out;
    }

    checkWorkSpanViolations(cps) {
      const out = [];
      const span = workSpan(cps);
      if (!span) return out;
      const maxSpan = this.isApprentice ? 12 : 14;
      if (span.duration.compare(Time.of(maxSpan)) > 0) {
        out.push({
          type: "violation",
          key: "spanExceeded",
          params: {
            span: span.duration.toString(),
            limit: maxSpan,
            start: span.start.toString(),
            end: span.end.toString(),
          },
        });
      }
      return out;
    }

    checkRestPeriod(previousDayEnd, cps) {
      const out = [];
      if (!previousDayEnd || !cps || cps.length === 0) return out;
      const start = cps[0];
      const rest = Time.of(24).sub(previousDayEnd).add(start);
      const required = Time.of(this.isApprentice ? 12 : 11);
      if (rest.compare(required) < 0) {
        out.push({
          type: "violation",
          key: "restPeriod",
          params: {
            required: required.toString(),
            rest: rest.toString(),
            yesterdayEnd: previousDayEnd.toString(),
            todayStart: Time.from(start).toString(),
          },
        });
      }
      return out;
    }
  }

  /**
   * True while clocked in and a break rule is being broken right now
   * (too long without a break, or too little break for the hours worked).
   * A block that was too long earlier today but has ended does not count.
   */
  function mustClockOut(findings, clockedIn) {
    const breakRules = ["noBreak15", "noBreak30", "break60Missing"];
    return clockedIn && findings.some((f) => f.type === "violation" && breakRules.includes(f.key) && f.ongoing);
  }

  // ------------------------------------------------------------- day status

  function todayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function targetForToday(settings) {
    const weekday = new Date().toLocaleDateString("en", { weekday: "long" }).toLowerCase();
    const cfg = (settings.dailyHours && settings.dailyHours[weekday]) || { hours: 8, minutes: 12 };
    return Time.of(cfg.hours, cfg.minutes);
  }

  /**
   * Everything the page panel and the popup show for today.
   * `checkpoints` are the stamps as "H:MM" strings (may be empty).
   */
  function computeDayStatus(settings, checkpoints, absenceMinutes = 0) {
    const hasStamps = checkpoints.length > 0;
    // Same as v2.0.0: without any stamp yet, the day is counted from now.
    const cps = hasStamps ? checkpoints : [new Time().toString()];
    const absence = new Time(absenceMinutes);
    const target = targetForToday(settings);
    const breakRequired = absence.compare(target.sub("5:30")) <= 0;
    const calculator = new TimeCalculator(new Time(breakRequired ? 30 : 0), target);

    const timeSpent = calculator.timeSpent(cps, absence);
    const timeToGo = calculator.timeToGo(cps, absence);
    const goHomeTime = calculator.goTime(cps, absence);
    const breaks = calculator.breaks(cps);
    const ratio = target.totalMinutes > 0 ? timeSpent.totalMinutes / target.totalMinutes : 0;

    return {
      hasStamps,
      clockedIn: hasStamps && isClockedIn(checkpoints),
      target,
      timeSpent,
      timeToGo,
      goHomeTime,
      breaks,
      absence,
      minimumBreak: calculator.minimumBreak,
      overtime: timeToGo.isNegative ? new Time(-timeToGo.totalMinutes) : null,
      progress: Math.max(0, Math.min(1, ratio)),
    };
  }

  // ------------------------------------------------------------------ extras

  const MINUS = "\u2212";

  /** "−2:53", "-2:53", "+0:10" or "1:05" -> minutes. Null if it is not a time. */
  function parseSignedTime(text) {
    const match = String(text).replace(/\s/g, "").match(/^([\u2212\u2013+-]?)(\d+):(\d{2})$/);
    if (!match) return null;
    const minutes = 60 * parseInt(match[2], 10) + parseInt(match[3], 10);
    return match[1] && match[1] !== "+" ? -minutes : minutes;
  }

  /** Minutes -> "+0:45", "−2:37" or "0:00". */
  function formatSigned(minutes) {
    const abs = Math.abs(minutes);
    const body = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
    return minutes > 0 ? `+${body}` : minutes < 0 ? `${MINUS}${body}` : body;
  }

  /**
   * The break that is running right now (clocked out between two stamps).
   * Null when clocked in, when the target is already reached, or when the
   * last stamp is so long ago that it is the end of the day rather than a break.
   */
  function runningBreak(status, checkpoints) {
    if (!status.hasStamps || status.clockedIn || status.timeToGo.totalMinutes <= 0) return null;
    const sorted = [...checkpoints].sort((a, b) => Time.from(a).compare(Time.from(b)));
    const since = Time.from(sorted[sorted.length - 1]);
    const current = new Time().sub(since).totalMinutes;
    if (current < 0 || current > 180) return null;
    const required = status.minimumBreak.totalMinutes;
    const total = status.breaks.totalMinutes + current;
    return { since, current, total, required, remaining: Math.max(0, required - total) };
  }

  /** Plus or minus for today (in minutes) if you leave at `leaveMinutes` (minutes of the day). */
  function leaveAtDifference(status, leaveMinutes) {
    return leaveMinutes - status.goHomeTime.totalMinutes;
  }

  /**
   * Jazz's time balance plus today so far. Null if there is no balance,
   * or if Jazz already counts today into it.
   */
  function timeBalanceWithToday(balances, status) {
    if (!balances || !balances.time) return null;
    const base = parseSignedTime(balances.time.value);
    if (base === null) return null;
    const now = new Date();
    const today = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    if (balances.time.asOf === today) return null;
    return base + status.timeSpent.totalMinutes - status.target.totalMinutes;
  }

  /** Short text for the toolbar icon: time to go, or the overtime once the target is passed. */
  function badgeText(status) {
    const toGo = status.timeToGo.totalMinutes;
    if (toGo >= 0) return status.timeToGo.toString();
    const over = -toGo;
    return over < 100 ? `+${over}` : `+${Math.floor(over / 60)}h`;
  }

  // ------------------------------------------------------------ translations

  const STRINGS = {
    en: {
      // page panel + popup live card
      panelTitle: "Status",
      rulesOk: "All break rules met",
      timeSpent: "Time spent",
      timeToGo: "Time to go",
      goHome: "Go home",
      overtime: "Overtime",
      breakTaken: "Break",
      absence: "Absence",
      timeBalance: "Time balance",
      vacationBalance: "Vacation balance",
      unitHours: "hrs",
      unitDays: "days",
      asOf: "as of {date}",
      balanceToday: "incl. today",
      balancesTitle: "Balances",
      weekTitle: "Week",
      weekSum: "{done} of {total}",
      dayShort_monday: "Mo",
      dayShort_tuesday: "Tu",
      dayShort_wednesday: "We",
      dayShort_thursday: "Th",
      dayShort_friday: "Fr",
      breakRunning: "On break since {since} \u00b7 {current}",
      breakLeft: "{time} left until {n} min of break",
      breakDone: "{n} min of break reached",
      whatIfBefore: "If I leave at",
      whatIfAfter: "",
      whatIfBalance: "Time balance then {value}",
      autoSaved: "Saved",
      toolWhatIf: "If I leave at \u2026",
      toolWeek: "Week overview",
      toolDark: "Dark mode",
      target: "Target",
      clockedIn: "Clocked in",
      clockedOut: "Clocked out",
      clockOutNow: "CLOCK OUT!!!",
      updatedAt: "Updated {time}",
      noDataTitle: "No data for today yet",
      noDataBody: "Open the time stamp page in Jazz once. After that your day shows up here.",
      // popup
      settingsTitle: "Settings",
      apprentice: "I am an apprentice",
      apprenticeDesc: "Additional work time restrictions apply for apprentices.",
      showWarnings: "Show warnings",
      showWarningsDesc: "Preventive alerts before a rule is about to be broken.",
      showViolations: "Show violations",
      showViolationsDesc: "Alerts when work time regulations are breached.",
      notifications: "Notifications",
      notificationsDesc: "Browser notification before you can go home and when a warning comes up.",
      notifyLead: "Remind me before going home",
      minutesShort: "{n} min",
      sectionAlerts: "Alerts",
      sectionHours: "Target hours per day",
      hoursHint: "Default: 8:12 on weekdays.",
      monday: "Monday",
      tuesday: "Tuesday",
      wednesday: "Wednesday",
      thursday: "Thursday",
      friday: "Friday",
      hours: "hours",
      minutes: "minutes",
      saveError: "Could not save the settings. Please try again.",
      loadError: "Could not load the settings.",
      errHours: "Hours for {day} must be between 0 and 12.",
      errMinutes: "Minutes for {day} must be between 0 and 59.",
      rulesTitle: "Work time regulations",
      rulesFull: "Full-time rules",
      rulesApprentice: "Apprentice rules",
      createdBy: "Created by",
      contact: "For bug reports or feature requests, reach out via email or Teams.",
      version: "Version",
      repository: "Code repository",
      thanks: "Thanks to {name} for his contributions.",
      language: "Language",
      // notifications
      notifySoonTitle: "Almost done",
      notifySoonBody: "You can go home in {n} minutes, at {time}.",
      notifyNowTitle: "Target reached",
      notifyNowBody: "You have reached your target time for today. You can go home.",
      notifyWarningTitle: "Work time warning",
      // rules
      lateStart:
        "You started work at {start} today. As an apprentice, you should start work by 9:00 at the latest.",
      break15Soon:
        "You have been working continuously for {duration} hours without a 15-minute break (since {since}). Please take a break within {minutes} minutes.",
      break30Soon:
        "You have been working continuously for {duration} hours without a 30-minute break (since {since}). Please take a break within {minutes} minutes.",
      dailyLimitSoonApprentice:
        "You should finish work within {minutes} minutes to avoid exceeding the maximum daily work limit of {limit} hours as an apprentice.",
      dailyLimitSoon:
        "You should finish work within {minutes} minutes to stay within the normal daily work time of {limit} hours.",
      over10h:
        "You have worked for {spent} hours and have exceeded the normal daily work time of 10 hours. You should finish work now. Maximum allowed is 12 hours 30 minutes in exceptional cases.",
      break60Soon:
        "In {minutes} minutes, you will need a total of 60 minutes of break time. You still need to take {missing} minutes more to meet this requirement.",
      spanSoon:
        "Your work span (including breaks) is {span} hours. You must finish work within {minutes} minutes to stay within the {limit}-hour daily span limit.",
      stopBy20: "You should stop working by 20:00. Please finish your work within {minutes} minutes.",
      maxDaily: "You have worked for {spent} hours, exceeding the maximum daily work limit of {limit} hours!",
      noBreak15:
        "You have worked for {duration} hours without taking a 15-minute break (from {from} to {to}). For work periods exceeding 5 hours and 30 minutes, a 15-minute break is mandatory.",
      noBreak30:
        "You have worked for {duration} hours without taking a 30-minute break (from {from} to {to}). For work periods exceeding 7 hours, a 30-minute break is mandatory.",
      break60Missing:
        "You only took {taken} minutes of total break time. For work exceeding 9 hours, you must take at least {required} minutes of breaks.",
      before6: "You shouldn't start work before 6:00. Today you started working at {start}.",
      after20: "You shouldn't work after 20:00. Today you worked until {end}.",
      spanExceeded:
        "Your work span (including breaks) is {span} hours, exceeding the maximum {limit}-hour daily span limit! Today you started work at {start} and finished at {end}.",
      restPeriod:
        "You need at least {required} hours of rest between work days, but you only had {rest} hours. Yesterday ended at {yesterdayEnd}, today started at {todayStart}.",
    },
    de: {
      panelTitle: "Status",
      rulesOk: "Alle Pausenregeln eingehalten",
      timeSpent: "Gearbeitet",
      timeToGo: "Verbleibend",
      goHome: "Feierabend",
      overtime: "Überzeit",
      breakTaken: "Pause",
      absence: "Absenz",
      timeBalance: "Zeitsaldo",
      vacationBalance: "Feriensaldo",
      unitHours: "Std.",
      unitDays: "Tage",
      asOf: "per {date}",
      balanceToday: "inkl. heute",
      balancesTitle: "Salden",
      weekTitle: "Woche",
      weekSum: "{done} von {total}",
      dayShort_monday: "Mo",
      dayShort_tuesday: "Di",
      dayShort_wednesday: "Mi",
      dayShort_thursday: "Do",
      dayShort_friday: "Fr",
      breakRunning: "Pause seit {since} \u00b7 {current}",
      breakLeft: "noch {time} bis {n} Min. Pause",
      breakDone: "{n} Min. Pause erreicht",
      whatIfBefore: "Wenn ich um",
      whatIfAfter: "gehe",
      whatIfBalance: "Zeitsaldo dann {value}",
      autoSaved: "Gespeichert",
      toolWhatIf: "Wenn ich um \u2026 gehe",
      toolWeek: "Wochen\u00fcbersicht",
      toolDark: "Dunkler Modus",
      target: "Soll",
      clockedIn: "Eingestempelt",
      clockedOut: "Ausgestempelt",
      clockOutNow: "AUSSTEMPELN!!!",
      updatedAt: "Stand {time}",
      noDataTitle: "Noch keine Daten für heute",
      noDataBody: "Öffne einmal die Stempelseite in Jazz. Danach siehst du deinen Tag hier.",
      settingsTitle: "Einstellungen",
      apprentice: "Ich bin Lernende/r",
      apprenticeDesc: "Für Lernende gelten zusätzliche Arbeitszeitregeln.",
      showWarnings: "Warnungen anzeigen",
      showWarningsDesc: "Hinweise, bevor eine Regel verletzt wird.",
      showViolations: "Verstösse anzeigen",
      showViolationsDesc: "Meldungen, wenn eine Arbeitszeitregel verletzt wurde.",
      notifications: "Benachrichtigungen",
      notificationsDesc: "Browser-Meldung vor dem Feierabend und wenn eine Warnung auftaucht.",
      notifyLead: "Erinnerung vor dem Feierabend",
      minutesShort: "{n} Min.",
      sectionAlerts: "Hinweise",
      sectionHours: "Sollzeit pro Tag",
      hoursHint: "Standard: 8:12 an Wochentagen.",
      monday: "Montag",
      tuesday: "Dienstag",
      wednesday: "Mittwoch",
      thursday: "Donnerstag",
      friday: "Freitag",
      hours: "Stunden",
      minutes: "Minuten",
      saveError: "Die Einstellungen konnten nicht gespeichert werden. Bitte versuche es nochmals.",
      loadError: "Die Einstellungen konnten nicht geladen werden.",
      errHours: "Die Stunden für {day} müssen zwischen 0 und 12 liegen.",
      errMinutes: "Die Minuten für {day} müssen zwischen 0 und 59 liegen.",
      rulesTitle: "Arbeitszeitregelungen",
      rulesFull: "Regeln Vollzeit",
      rulesApprentice: "Regeln Lernende",
      createdBy: "Erstellt von",
      contact: "Fehler oder Wünsche gerne per E-Mail oder Teams melden.",
      version: "Version",
      repository: "Code-Repository",
      thanks: "Danke an {name} für seine Beiträge.",
      language: "Sprache",
      notifySoonTitle: "Fast geschafft",
      notifySoonBody: "In {n} Minuten, um {time}, kannst du Feierabend machen.",
      notifyNowTitle: "Soll erreicht",
      notifyNowBody: "Du hast deine Sollzeit für heute erreicht. Du kannst Feierabend machen.",
      notifyWarningTitle: "Arbeitszeit-Warnung",
      lateStart:
        "Du hast heute um {start} angefangen. Als Lernende/r solltest du spätestens um 9:00 beginnen.",
      break15Soon:
        "Du arbeitest seit {duration} Stunden ohne 15-minütige Pause (seit {since}). Mach bitte innerhalb von {minutes} Minuten eine Pause.",
      break30Soon:
        "Du arbeitest seit {duration} Stunden ohne 30-minütige Pause (seit {since}). Mach bitte innerhalb von {minutes} Minuten eine Pause.",
      dailyLimitSoonApprentice:
        "Du solltest innerhalb von {minutes} Minuten aufhören, damit du die maximale tägliche Arbeitszeit von {limit} Stunden für Lernende nicht überschreitest.",
      dailyLimitSoon:
        "Du solltest innerhalb von {minutes} Minuten aufhören, damit du in der normalen täglichen Arbeitszeit von {limit} Stunden bleibst.",
      over10h:
        "Du hast {spent} Stunden gearbeitet und die normale tägliche Arbeitszeit von 10 Stunden überschritten. Du solltest jetzt aufhören. Maximal erlaubt sind in Ausnahmefällen 12 Stunden 30 Minuten.",
      break60Soon:
        "In {minutes} Minuten brauchst du insgesamt 60 Minuten Pause. Dir fehlen dafür noch {missing} Minuten.",
      spanSoon:
        "Deine Arbeitsspanne (inklusive Pausen) beträgt {span} Stunden. Du musst innerhalb von {minutes} Minuten aufhören, um die tägliche Spanne von {limit} Stunden einzuhalten.",
      stopBy20: "Du solltest bis 20:00 aufhören. Bitte beende deine Arbeit innerhalb von {minutes} Minuten.",
      maxDaily:
        "Du hast {spent} Stunden gearbeitet und damit die maximale tägliche Arbeitszeit von {limit} Stunden überschritten!",
      noBreak15:
        "Du hast {duration} Stunden ohne 15-minütige Pause gearbeitet (von {from} bis {to}). Bei mehr als 5 Stunden 30 Minuten Arbeit am Stück ist eine 15-minütige Pause Pflicht.",
      noBreak30:
        "Du hast {duration} Stunden ohne 30-minütige Pause gearbeitet (von {from} bis {to}). Bei mehr als 7 Stunden Arbeit am Stück ist eine 30-minütige Pause Pflicht.",
      break60Missing:
        "Du hast insgesamt nur {taken} Minuten Pause gemacht. Bei mehr als 9 Stunden Arbeit sind mindestens {required} Minuten Pause Pflicht.",
      before6: "Du solltest nicht vor 6:00 anfangen. Heute hast du um {start} begonnen.",
      after20: "Du solltest nicht nach 20:00 arbeiten. Heute hast du bis {end} gearbeitet.",
      spanExceeded:
        "Deine Arbeitsspanne (inklusive Pausen) beträgt {span} Stunden und überschreitet die maximale tägliche Spanne von {limit} Stunden! Heute hast du um {start} angefangen und um {end} aufgehört.",
      restPeriod:
        "Zwischen zwei Arbeitstagen brauchst du mindestens {required} Stunden Ruhezeit, du hattest aber nur {rest} Stunden. Gestern war um {yesterdayEnd} Schluss, heute hast du um {todayStart} begonnen.",
    },
  };

  /** "auto" follows the browser language; anything that is not German falls back to English. */
  function resolveLanguage(setting) {
    if (setting === "de" || setting === "en") return setting;
    const browser = (typeof navigator !== "undefined" && navigator.language) || "en";
    return browser.toLowerCase().startsWith("de") ? "de" : "en";
  }

  function translate(lang, key, params = {}) {
    const table = STRINGS[lang] || STRINGS.en;
    const template = table[key] !== undefined ? table[key] : STRINGS.en[key] !== undefined ? STRINGS.en[key] : key;
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }

  globalThis.JTT = {
    DAYS,
    DEFAULT_SETTINGS,
    SettingsManager,
    Time,
    TimeCalculator,
    ComplianceRules,
    computeDayStatus,
    mustClockOut,
    parseSignedTime,
    formatSigned,
    runningBreak,
    leaveAtDifference,
    timeBalanceWithToday,
    badgeText,
    todayKey,
    resolveLanguage,
    translate,
    isClockedIn,
  };
})();
