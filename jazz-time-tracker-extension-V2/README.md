# Jazz Time Tracker 2.1.0

Time tracking and work time checks for Jazz. Works on Chrome, Chromium, Edge, Opera, Brave and Firefox (121+).

Original extension by Lorenz Boss, with contributions from Levin Schaller.
Version 2.1.0 is a redesign with a few additions; the time calculation and the work time rules are unchanged from 2.0.0.

## New in 2.1.0

On the Jazz stamp page ("Status" block, in the look of Jazz itself):
- Clocked in / clocked out, time spent, time to go (negative once the target is passed), go-home time
- Progress bar: work, absence booked in Jazz and overtime; break and overtime below it
- Red "CLOCK OUT!!!" while a break rule is being broken
- Break timer while clocked out
- "If I leave at ..." with the resulting plus or minus
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
