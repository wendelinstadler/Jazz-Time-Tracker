# Jazz Time Tracker 2.1.0

Time tracking and work time checks for Jazz. Works on Chrome, Chromium, Edge, Opera, Brave and Firefox (121+).

Developer: [Wendelin Stadler](https://github.com/wendelinstadler) · Repository: https://github.com/wendelinstadler/Jazz-Time-Tracker

Based on the Jazz Time Tracker 2.0 by Lorenz Boss; the time calculation and the work time rules come from there.
Version 2.1.0 is a redesign with a few additions; the time calculation and the work time rules are unchanged from 2.0.0.

## New in 2.1.0

On the Jazz stamp page ("Status" block, in the look of Jazz itself):
- Clocked in / clocked out, time spent, time to go (negative once the target is passed), go-home time
- Progress bar: work, absence booked in Jazz and overtime; break and overtime below it
- Red "CLOCK OUT!!!" while a break rule is being broken
- Break timer while clocked out
- Break window: from when a break makes sense (so the rest of the day fits without another one) and when it is due at the latest (5:30 rule)
- "Plan" button: if I leave at ..., planned lunch break with the resulting go-home time
- "Balance goal" button: how much longer per day to reach a time balance by a date; the saved goal is shown every day in the block and the popup ("today +0:20 until 17:42"); can be switched on and off
- Notification when the required break is complete
- Time to go in the browser tab title
- "History" button (all recorded days are kept, no limit): today vs. a normal day (worked hours added up over the day); the normal line is the average of the last 3, 5 or 20 working days or all known days (3 days / week / month / max), plus the time balance over the same period, recorded each day the stamp page is opened
- Popup: export and import of all data as a file, plus an automatic monthly backup to Downloads/Jazz Time Tracker (can be switched off)
- Top right: a "More" menu with Plan, Week, History, Records and Balance goal; dark mode stays a direct button
- "Records" (own entry in the menu): earliest start, longest day, days in a row without a broken break rule
- Help button (?) in the block that explains every part
- "What's new" in the popup once after each update
- Settings, school days, goal and plan synced through the browser account (Chrome sync), can be switched off in the popup
- Dark mode is applied before the page is drawn, so it no longer flashes white
- School days per weekday (popup settings, apprentices only): shown as "School day today", left out of the week total and the balance goal
- Alt+J (Option+J on Mac) switches to or opens the Jazz stamp page; change it under chrome://extensions/shortcuts
- Week overview, Monday to Friday, read from the days on the page
- Buttons at the top of the block: DE/EN, "If I leave at ...", week overview, dark mode
- EN translates the known texts of the Jazz stamp page as well; dark mode darkens the whole page
- Time and vacation balance read from the bottom of the page, plus the time balance including today
- "All break rules met" when nothing is open

Elsewhere:
- Toolbar icon shows a progress ring with the percentage of the day
- Popup with live status, balances and settings that save automatically
- Browser notifications before going home, when the target is reached, and when a warning comes up
- German and English, light and dark

The balances and the week are found by the German labels and the structure of the Jazz page.
If Jazz is set to French or Italian, or the page is built differently, those parts stay hidden.

## Installation

Close the Jazz website before installing. If the old version is installed, remove it first.

### Chrome / Chromium / Edge / Opera / Brave
1. Open the extensions page of the browser
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select this folder (`jazz-time-tracker-extension`)

### Firefox
1. Go to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file in this folder

Firefox installs it temporarily; a permanent install needs a build signed by Mozilla.

## Files

- `dist/core.js` – time maths, rules, settings, translations (shared)
- `dist/main.js` – runs on the Jazz page
- `dist/popup.html`, `popup.css`, `popup.js` – the popup
- `dist/background.js` – notifications
