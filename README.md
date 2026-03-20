# RaceApp MileSplit Entry Extension

Browser extension that auto-fills MileSplit meet registration from your [RaceApp](https://raceapp.net/event-planner) event planner. Instead of manually clicking through 30+ event pages checking athlete boxes one by one, this extension reads your event assignments and checks the right boxes for you.

Works in Chrome and Firefox.

## How it works

1. Open your event planner on RaceApp
2. Click the extension icon, then "Scrape from RaceApp Tab" — this reads the athlete/event grid
3. Navigate to MileSplit's meet registration
4. A side panel appears showing which athletes to enter for each event
5. Click "Check All Matched" to auto-check the boxes, or handle them individually

## What's in here

| File | What it does |
|------|-------------|
| `manifest.json` | Extension config — declares permissions and which pages the content script runs on |
| `popup.html` / `popup.js` | The popup when you click the extension icon. Scrapes RaceApp tab or accepts pasted JSON. Shows plan summary. |
| `content.js` | Runs only on MileSplit registration pages. Reads the stored plan, matches athlete names to MileSplit's checkbox labels, shows the side panel. |
| `content.css` | Styles for the side panel injected into MileSplit pages. |
| `icon*.png` | Placeholder icons. |

## Permissions explained

| Permission | Why it's needed | What it can't do |
|-----------|----------------|-----------------|
| `storage` | Saves your entry plan locally in the browser so it persists across page navigations | Cannot access your browsing history, passwords, or any other extension's data |
| `activeTab` | Lets the popup read the RaceApp event planner tab when you click the extension icon | Cannot read any tab you haven't explicitly clicked the icon on. Cannot run in the background. |
| `scripting` | Injects the scraper function into the RaceApp tab to read the event grid | Only executes when you click "Scrape from RaceApp Tab" in the popup. Does not run automatically. |

The content script (`content.js`) only runs on pages matching `*.milesplit.com/meets/*/registration/sessions/*/events/*`. It does not run on any other website.

## What this extension does NOT do

- **No network requests.** Zero. Nothing leaves your browser. There is no server, no analytics, no telemetry.
- **No background processes.** Nothing runs when you're not on a MileSplit registration page.
- **No data collection.** Athlete names are stored temporarily in local browser storage and cleared when you click "Clear Plan."
- **No access to other sites.** The content script is restricted to MileSplit registration pages. The scraper only runs on the active tab when you explicitly click the button.

## Security review

The entire extension is under 900 lines of JavaScript across two files. You are encouraged to review it yourself or ask any AI assistant to audit it for you.

**How to get an AI security review:**

Try giving an AI the GitHub link directly:

> "Review the source code at https://github.com/ncrosno/milesplit-extension — does this browser extension make any network requests, collect any data, or do anything beyond reading DOM elements on RaceApp and MileSplit pages?"

This works with Google AI Mode and some other tools. If the AI can't access the repo, open `manifest.json`, `popup.js`, and `content.js` in a text editor, paste the contents, and ask the same question. The code is short enough for any AI to review in one shot.

## Install

### Download

1. On this GitHub page, click the green **Code** button, then **Download ZIP**
2. Extract the ZIP file somewhere on your computer (e.g., your Desktop or Downloads folder)

### Chrome
1. Open `chrome://extensions` in your address bar
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the extracted folder (the one containing `manifest.json`)

### Firefox
1. Open `about:debugging#/runtime/this-firefox` in your address bar
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file inside the extracted folder

Note: Firefox temporary add-ons are removed when Firefox closes. You'll need to re-load it each session.
