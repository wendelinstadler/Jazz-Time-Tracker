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
    autoBackup: true,
    syncSettings: true,
    dailySchool: { monday: false, tuesday: false, wednesday: false, thursday: false, friday: false },
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

  /**
   * Go-home time if the day's break is `breakMinutes` long and starts at `startMinutes`.
   * Breaks already taken today count towards it, and the required minimum break still applies.
   */
  function plannedGoHome(status, startMinutes, breakMinutes) {
    const now = new Time().totalMinutes;
    const taken = status.breaks.totalMinutes;
    const stillToWork = status.target.totalMinutes - status.timeSpent.totalMinutes;
    const wanted = Math.max(0, breakMinutes - taken);
    const required = Math.max(0, status.minimumBreak.totalMinutes - taken);
    const remaining = Math.max(wanted, required);
    return {
      goHome: new Time(now + Math.max(0, stillToWork) + remaining),
      breakEnd: new Time(Math.max(startMinutes, now) + remaining),
      remaining,
      added: remaining - wanted,
    };
  }

  /**
   * Extra minutes per working day (Mon-Fri) needed to bring the time balance from `base`
   * to `goal` by `untilKey` ("YYYY-MM-DD"). Today counts unless Jazz's balance already includes it.
   * Public holidays are not known and count as working days.
   */
  function goalPerDay(base, goal, untilKey, asOf, status, school = {}) {
    const isWorkday = (day) => day.getDay() !== 0 && day.getDay() !== 6 && !school[WEEKDAY_KEYS[day.getDay()]];
    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (asOf === todayStr ? 1 : 0));
    const [y, m, d] = untilKey.split("-").map(Number);
    const end = new Date(y, m - 1, d);
    let days = 0;
    for (const day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      if (isWorkday(day)) days++;
    }
    if (days === 0) return { days, perDay: 0, todayGoHome: null };
    const perDay = Math.ceil((goal - base) / days);
    const todayCounts = asOf !== todayStr && isWorkday(now);
    return {
      days,
      perDay,
      todayGoHome: todayCounts && perDay > 0 ? new Time(status.goHomeTime.totalMinutes + perDay) : null,
    };
  }

  const WEEKDAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  /** School days only exist for apprentices; for everyone else none of them count. */
  function schoolDays(settings) {
    return settings.isApprentice && settings.dailySchool ? settings.dailySchool : {};
  }

  /** True if today is marked as a school day in the settings. */
  function isSchoolToday(settings, date = new Date()) {
    return Boolean(schoolDays(settings)[WEEKDAY_KEYS[date.getDay()]]);
  }

  /**
   * When to take the next break. Rule: at most 5:30 of work without a 15-minute break.
   * - latest: the current stretch of work reaches 5:30
   * - earliest: early enough is pointless if more than 5:30 of work would still follow,
   *   because then another break would be needed before going home
   * Null when clocked out. `needed: false` when the rest of the day fits without a break.
   */
  function breakWindow(status, checkpoints) {
    if (!status.clockedIn) return null;
    const limit = 330;
    const now = new Time().totalMinutes;
    const cps = new TimeCalculator(new Time(0), new Time(0)).getExtendedCheckpoints(checkpoints);
    const blocks = continuousBlocks(cps, Time.of(0, 15));
    const stretch = blocks.length ? blocks[blocks.length - 1].duration.totalMinutes : 0;
    const stillToWork = Math.max(0, status.target.totalMinutes - status.timeSpent.totalMinutes);
    if (stretch + stillToWork <= limit) return { needed: false };
    const earliest = now + Math.max(0, stillToWork - limit);
    const latest = now + Math.max(0, limit - stretch);
    return { needed: true, earliest: new Time(earliest), latest: new Time(latest), twoBreaks: earliest > latest };
  }

  /**
   * The saved balance goal for today, or null when it cannot be worked out.
   * `plan` holds goal ("+1:00") and goalDate ("YYYY-MM-DD", empty = end of this month).
   */
  function goalToday(plan, balances, status, school = {}) {
    if (!plan || !balances || !balances.time) return null;
    const base = parseSignedTime(balances.time.value);
    const goal = parseSignedTime(plan.goal || "");
    if (base === null || goal === null) return null;
    let until = plan.goalDate;
    if (!until) {
      const now = new Date();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      until = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
    }
    return { goal, until, ...goalPerDay(base, goal, until, balances.time.asOf, status, school) };
  }

  /** One line for the status block and the popup: "Für dein Ziel heute +0:50 · Feierabend 18:42". */
  function describeGoalToday(result, lang) {
    if (!result) return null;
    if (result.days === 0) return { text: translate(lang, "goalLineOver"), kind: "muted" };
    if (result.perDay <= 0) return { text: translate(lang, "goalLineReached"), kind: "ok" };
    const value = formatSigned(result.perDay);
    return result.todayGoHome
      ? { text: translate(lang, "goalLine", { value, time: result.todayGoHome.toString() }), kind: "todo" }
      : { text: translate(lang, "goalLineNoToday", { value }), kind: "todo" };
  }

  // ------------------------------------------------------------------ backup

  /** Stored data that goes into a backup besides the settings. */
  const BACKUP_KEYS = ["jttPlan", "jttOpen", "jttSaldoHistory", "jttDays"];

  /** Reads everything for a backup and hands back the file content. */
  function readBackup(callback) {
    const keys = { ...DEFAULT_SETTINGS };
    for (const key of BACKUP_KEYS) keys[key] = null;
    chrome.storage.local.get(keys, (items) => {
      const data = {
        app: "jazz-time-tracker",
        version: chrome.runtime.getManifest().version,
        exported: new Date().toISOString(),
        data: items,
      };
      callback(JSON.stringify(data, null, 2), items);
    });
  }

  /** What's new per version: number of lines (texts are new_<version>_<i>). */
  const WHATS_NEW = { "2.1.0": 6 };

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
      dayShort_saturday: "Sa",
      dayShort_sunday: "Su",
      saturday: "Saturday",
      sunday: "Sunday",
      breakRunning: "On break since {since} \u00b7 {current}",
      breakLeft: "{time} left until {n} min of break",
      breakDone: "{n} min of break reached",
      whatIfBefore: "If I leave at",
      whatIfAfter: "",
      whatIfBalance: "Time balance then {value}",
      autoSaved: "Saved",
      school: "School",
      toolHistory: "History",
      toolMore: "More",
      whatsNewTitle: "New in version {version}",
      whatsNewOk: "Got it",
      syncSettings: "Sync settings",
      syncSettingsDesc: "Target hours, school days, goal and plan via your browser account (Chrome sync).",
      new_2_1_0_0: "The status block in the look of Jazz, with progress bar, balances and break times",
      new_2_1_0_1: "More menu: plan, week, history chart, records and balance goal",
      new_2_1_0_2: "Toolbar icon with today's percentage, and Alt+J for the stamp page",
      new_2_1_0_3: "Notifications before going home and when a break is complete",
      new_2_1_0_4: "German / English, dark mode, school days for apprentices",
      new_2_1_0_5: "Automatic monthly backup and settings synced across your browsers",
      toolHelp: "Help",
      helpTitle: "What is what",
      help_status_term: "Status",
      help_status_text: "Clocked in or out, time spent, time to go (negative = overtime) and when you can go home.",
      help_bar_term: "Bar",
      help_bar_text: "Green = work, blue = absence booked in Jazz (e.g. an appointment), orange = overtime. Below: break and overtime.",
      help_breaks_term: "Breaks",
      help_breaks_text: "While clocked in: from when a break makes sense and when it is due at the latest. While clocked out: the running break.",
      help_clockout_term: "CLOCK OUT!!!",
      help_clockout_text: "Appears in red while a break rule is being broken right now.",
      help_balances_term: "Balances",
      help_balances_text: "Time and vacation balance from the bottom of the Jazz page, plus the time balance including today.",
      help_menu_term: "More (•••)",
      help_menu_text: "Plan (leave at …, lunch break), week overview, history with chart, records and balance goal.",
      help_top_term: "DE / EN and moon",
      help_top_text: "Language of the extension and the Jazz page, and dark mode for the whole page.",
      help_icon_term: "Toolbar icon",
      help_icon_text: "Ring with the percentage of today; hover for the times. Alt+J (Option+J) opens the stamp page.",
      help_popup_term: "Popup",
      help_popup_text: "Click the icon: live status, settings (target hours, school days, notifications) and backups.",
      toolRecords: "Records",
      recordsTitle: "Records ({n} days)",
      recordsTitleEmpty: "Records appear once a few working days are known",
      recEarliest: "Earliest start",
      recLongest: "Longest day",
      recStreak: "Without break violation",
      recDay: "1 day",
      recDays: "{n} days",
      recBest: "record {n}",
      dayChartTitle: "Today vs. normal",
      rangeLabel: "Normal from",
      range_three: "3 days",
      range_week: "Week",
      range_month: "Month",
      range_max: "Max",
      dayToday: "Today",
      dayNormal: "Normal",
      dayModel: "Typical day",
      dayAhead: "{value} ahead",
      dayBehind: "{value} behind",
      dayEven: "same as usual",
      dayNormalNote: "Normal = average of your last {n} working days.",
      dayModelNote: "No past days known yet, so the normal line assumes 8:00 start and a 30 min break at 12:00.",
      goalLine: "Balance goal: today {value} \u00b7 until {time}",
      goalLineNoToday: "Balance goal: {value} per working day",
      goalLineReached: "Balance goal reached",
      goalOn: "Balance goal on, shown every day",
      goalOff: "Balance goal off",
      goalLineOver: "The date of your balance goal has passed",
      historyTitle: "Balance history",
      historyChange: "since {from}: {value}",
      historyEmpty: "Recording starts today: one point is added for every day you open the stamp page.",
      historyFew: "More points are added each day you open the stamp page.",
      backupTitle: "Back up data",
      backupText: "Settings, plans and the balance history as a file, e.g. for another computer.",
      backupExport: "Export",
      backupImport: "Import",
      backupImported: "Imported",
      backupInvalid: "This is not a Jazz Time Tracker backup.",
      autoBackup: "Back up automatically every month",
      autoBackupDesc: "Saved to Downloads \u2192 Jazz Time Tracker.",
      lastBackup: "Last backup: {date}",
      noBackupYet: "No backup yet",
      autoBackupDoneTitle: "Backup saved",
      autoBackupDoneBody: "Your Jazz Time Tracker data is in Downloads \u2192 Jazz Time Tracker.",
      breakWindow: "Best break time: from {from}, at the latest {to}",
      breakWindowNow: "Take a break by {to} at the latest",
      breakWindowTwo: "Two breaks needed today, the first by {to}",
      breakWindowNone: "No further break needed today",
      schoolShort: "School",
      schoolToday: "School day today",
      schoolTodayNote: "No work time planned. Stamps still count if you work part of the day.",
      schoolToggle: "{day} is a school day",
      schoolHint: "School days do not count in the week total or the balance goal.",
      toolWhatIf: "Plan",
      toolGoal: "Balance goal",
      goalTitle: "Balance goal",
      planTitle: "Plan",
      lunchBefore: "Break at",
      lunchMiddle: "for",
      lunchAfter: "min",
      lunchResult: "Home at {time}",
      lunchAtLabel: "Break starts at",
      lunchMinLabel: "Break length in minutes",
      lunchNote: "Break until {end}",
      lunchDone: "Break already taken today",
      lunchNoteTopped: "Break until {end}, topped up to the {n} min minimum break",
      lunchOnlyClockedIn: "Works while you are clocked in",
      goalBefore: "Time balance",
      goalMiddle: "by",
      goalLabel: "Target time balance",
      goalDateLabel: "Target date",
      goalPerDay: "{value} per day",
      goalReached: "Goal reached",
      goalReachedNote: "With {days} working days left you could even work {value} less per day",
      goalNote: "{days} working days left \u00b7 today until {time}",
      goalNoteNoToday: "{days} working days left",
      goalNoDays: "No working day left until that date",
      goalNoBalance: "No time balance found on the page",
      breakDoneTitle: "Break done",
      breakDoneBody: "Your {n} minutes of break are complete. You can clock in again.",
      tabToGo: "{time} to go",
      tabOvertime: "+{time} overtime",
      tabBreak: "Break {time}",
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
      dayShort_saturday: "Sa",
      dayShort_sunday: "So",
      saturday: "Samstag",
      sunday: "Sonntag",
      breakRunning: "Pause seit {since} \u00b7 {current}",
      breakLeft: "noch {time} bis {n} Min. Pause",
      breakDone: "{n} Min. Pause erreicht",
      whatIfBefore: "Wenn ich um",
      whatIfAfter: "gehe",
      whatIfBalance: "Zeitsaldo dann {value}",
      autoSaved: "Gespeichert",
      school: "Schule",
      toolHistory: "Verlauf",
      toolMore: "Mehr",
      whatsNewTitle: "Neu in Version {version}",
      whatsNewOk: "Alles klar",
      syncSettings: "Einstellungen synchronisieren",
      syncSettingsDesc: "Sollzeit, Schultage, Ziel und Planung \u00fcber dein Browser-Konto (Chrome-Sync).",
      new_2_1_0_0: "Status-Block im Jazz-Look mit Fortschrittsbalken, Salden und Pausenzeiten",
      new_2_1_0_1: "Menü «Mehr»: Planen, Woche, Verlauf mit Diagramm, Rekorde und Ziel-Saldo",
      new_2_1_0_2: "Icon oben im Browser mit dem Prozent von heute, und Alt+J für die Stempelseite",
      new_2_1_0_3: "Meldungen vor dem Feierabend und wenn die Pause vorbei ist",
      new_2_1_0_4: "Deutsch / Englisch, Dunkelmodus, Schultage für Lernende",
      new_2_1_0_5: "Automatische Sicherung jeden Monat und Einstellungen auf allen Browsern synchron",
      toolHelp: "Hilfe",
      helpTitle: "Was ist was",
      help_status_term: "Status",
      help_status_text: "Ein- oder ausgestempelt, gearbeitet, verbleibend (Minus = Überzeit) und wann du Feierabend hast.",
      help_bar_term: "Balken",
      help_bar_text: "Grün = Arbeit, blau = in Jazz eingetragene Absenz (z. B. Termin), orange = Überzeit. Darunter Pause und Überzeit.",
      help_breaks_term: "Pausen",
      help_breaks_text: "Eingestempelt: ab wann eine Pause sinnvoll ist und wann sie spätestens fällig ist. Ausgestempelt: die laufende Pause.",
      help_clockout_term: "AUSSTEMPELN!!!",
      help_clockout_text: "Erscheint in Rot, solange gerade eine Pausenregel verletzt wird.",
      help_balances_term: "Salden",
      help_balances_text: "Zeit- und Feriensaldo von unten auf der Jazz-Seite, dazu der Zeitsaldo inklusive heute.",
      help_menu_term: "Mehr (•••)",
      help_menu_text: "Planen (Wenn ich um … gehe, Mittagspause), Wochenübersicht, Verlauf mit Diagramm, Rekorde und Ziel-Saldo.",
      help_top_term: "DE / EN und Mond",
      help_top_text: "Sprache der Extension und der Jazz-Seite, und Dunkelmodus für die ganze Seite.",
      help_icon_term: "Icon oben im Browser",
      help_icon_text: "Ring mit dem Prozent von heute; mit der Maus darüber siehst du die Zeiten. Alt+J (Option+J) öffnet die Stempelseite.",
      help_popup_term: "Popup",
      help_popup_text: "Klick aufs Icon: Live-Status, Einstellungen (Sollzeit, Schultage, Benachrichtigungen) und Sicherung.",
      toolRecords: "Rekorde",
      recordsTitle: "Rekorde ({n} Tage)",
      recordsTitleEmpty: "Rekorde erscheinen, sobald ein paar Arbeitstage bekannt sind",
      recEarliest: "Fr\u00fchester Start",
      recLongest: "L\u00e4ngster Tag",
      recStreak: "Ohne Pausen-Verstoss",
      recDay: "1 Tag",
      recDays: "{n} Tage",
      recBest: "Rekord {n}",
      dayChartTitle: "Heute vs. normal",
      rangeLabel: "Normal aus",
      range_three: "3 Tage",
      range_week: "Woche",
      range_month: "Monat",
      range_max: "Max",
      dayToday: "Heute",
      dayNormal: "Normal",
      dayModel: "Typischer Tag",
      dayAhead: "{value} voraus",
      dayBehind: "{value} hinterher",
      dayEven: "wie immer",
      dayNormalNote: "Normal = Durchschnitt deiner letzten {n} Arbeitstage.",
      dayModelNote: "Noch keine fr\u00fcheren Tage bekannt, darum nimmt die Normal-Linie 8:00 Start und 30 Min. Pause um 12:00 an.",
      goalLine: "Ziel-Saldo: heute {value} \u00b7 bis {time}",
      goalLineNoToday: "Ziel-Saldo: {value} pro Arbeitstag",
      goalLineReached: "Ziel-Saldo erreicht",
      goalOn: "Ziel-Saldo an, wird jeden Tag angezeigt",
      goalOff: "Ziel-Saldo aus",
      goalLineOver: "Das Datum deines Ziel-Saldos ist vorbei",
      historyTitle: "Saldo-Verlauf",
      historyChange: "seit {from}: {value}",
      historyEmpty: "Die Aufzeichnung beginnt heute: Jeden Tag, an dem du die Stempelseite \u00f6ffnest, kommt ein Punkt dazu.",
      historyFew: "Jeden Tag, an dem du die Stempelseite \u00f6ffnest, kommt ein Punkt dazu.",
      backupTitle: "Daten sichern",
      backupText: "Einstellungen, Planung und Saldo-Verlauf als Datei, z. B. f\u00fcr einen anderen Computer.",
      backupExport: "Exportieren",
      backupImport: "Importieren",
      backupImported: "Importiert",
      backupInvalid: "Das ist keine Sicherung vom Jazz Time Tracker.",
      autoBackup: "Jeden Monat automatisch sichern",
      autoBackupDesc: "Wird in Downloads \u2192 Jazz Time Tracker gespeichert.",
      lastBackup: "Letzte Sicherung: {date}",
      noBackupYet: "Noch keine Sicherung",
      autoBackupDoneTitle: "Sicherung gespeichert",
      autoBackupDoneBody: "Deine Jazz-Time-Tracker-Daten liegen in Downloads \u2192 Jazz Time Tracker.",
      breakWindow: "Pause ideal ab {from}, sp\u00e4testens {to}",
      breakWindowNow: "Pause sp\u00e4testens um {to}",
      breakWindowTwo: "Heute sind zwei Pausen n\u00f6tig, die erste bis {to}",
      breakWindowNone: "Heute keine weitere Pause n\u00f6tig",
      schoolShort: "Schule",
      schoolToday: "Heute ist Schultag",
      schoolTodayNote: "Keine Arbeitszeit eingeplant. Wenn du doch stempelst, wird normal gerechnet.",
      schoolToggle: "{day} ist ein Schultag",
      schoolHint: "Schultage z\u00e4hlen nicht zur Wochensumme und nicht zum Ziel-Saldo.",
      toolWhatIf: "Planen",
      toolGoal: "Ziel-Saldo",
      goalTitle: "Ziel-Saldo",
      planTitle: "Planen",
      lunchBefore: "Pause um",
      lunchMiddle: "f\u00fcr",
      lunchAfter: "Min.",
      lunchResult: "Feierabend {time}",
      lunchAtLabel: "Beginn der Pause",
      lunchMinLabel: "Pausenl\u00e4nge in Minuten",
      lunchNote: "Pause bis {end}",
      lunchDone: "Pause heute schon gemacht",
      lunchNoteTopped: "Pause bis {end}, auf die Mindestpause von {n} Min. ergänzt",
      lunchOnlyClockedIn: "Funktioniert, solange du eingestempelt bist",
      goalBefore: "Zeitsaldo",
      goalMiddle: "bis",
      goalLabel: "Ziel-Zeitsaldo",
      goalDateLabel: "Zieldatum",
      goalPerDay: "{value} pro Tag",
      goalReached: "Ziel erreicht",
      goalReachedNote: "Bei {days} Arbeitstagen k\u00f6nntest du sogar {value} pro Tag weniger arbeiten",
      goalNote: "noch {days} Arbeitstage \u00b7 heute bis {time}",
      goalNoteNoToday: "noch {days} Arbeitstage",
      goalNoDays: "Bis zu diesem Datum gibt es keinen Arbeitstag mehr",
      goalNoBalance: "Kein Zeitsaldo auf der Seite gefunden",
      breakDoneTitle: "Pause vorbei",
      breakDoneBody: "Deine {n} Minuten Pause sind um. Du kannst wieder einstempeln.",
      tabToGo: "{time} bis Feierabend",
      tabOvertime: "+{time} \u00dcberzeit",
      tabBreak: "Pause {time}",
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
    plannedGoHome,
    goalPerDay,
    isSchoolToday,
    schoolDays,
    breakWindow,
    goalToday,
    BACKUP_KEYS,
    WHATS_NEW,
    SETTING_KEYS,
    readBackup,
    describeGoalToday,
    badgeText,
    todayKey,
    resolveLanguage,
    translate,
    isClockedIn,
  };
})();
