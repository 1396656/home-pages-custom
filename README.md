[![English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![简体中文](https://img.shields.io/badge/Language-简体中文-red)](README.zh-CN.md)

# Home Pages for Obsidian (Personal Custom Fork)

> This is a personal customized fork of [jepicaju862-lab/home-pages](https://github.com/jepicaju862-lab/home-pages). On top of the upstream version, it adds:
>
> **New widgets**
> - **Mistakes Reviewer**: draws random questions from a mistake-notes folder, rotating across subjects with per-day progress; question images support click-to-zoom lightbox (wheel zoom / pinch zoom / drag to pan).
> - **Idiom Review**: parses an idiom-collection note, shows a random idiom with its meaning, and cycles on confirm.
>
> **Enhancements**
> - **Habit Tracker**: new "monthly notes folder" data source (parses `## date` headings for daily tasks); week/month/year grids auto-size to fill the card height; year view scrolls to the latest date by default.
> - **Pomodoro**: completing a focus session can automatically check off a linked habit for today.
> - **Quick Links**: supports website shortcuts with automatically fetched favicons and page titles; site icons use a neutral translucent background.
> - **Media Feed**: adds two column sources (SouthCN Opinion, YCWB Reviews) with "next page" pagination and cross-page dedup.
>
> **Mobile adaptation**
> - Single-column layout now applies only on phones (`Platform.isPhone`); tablets in landscape show multiple columns like desktop; fixed pill buttons being squashed on narrow screens.

---

A modern, modular, and responsive homepage dashboard plugin for Obsidian. Built on a flexible 12-column adaptive grid, it empowers you to customize your workspace with draggable, resizable, and individually configurable widgets. Support multiple pages and third-party plugin integrations.

- **Current release:** v0.4.0 ([this repo's Releases](https://github.com/1396656/home-pages-custom/releases))
- **Minimum Obsidian version:** 1.7.2
- **Supported platforms:** Desktop and Obsidian Mobile (iOS / Android / tablets)
- **License:** [GNU General Public License v3.0](LICENSE)

> [!NOTE]
> **Local-First & Privacy Assured:** Home Pages operates entirely within your local Obsidian vault. Layouts, states, and settings are persisted locally in `data.json` without any background analytics, telemetry, or hidden network tracking.

---

## 🌟 Features

### 🧩 Rich Built-in Dashboard Widgets

Home Pages comes with 12+ built-in productivity widgets that can be freely combined and configured:

| Widget | Description | Key Configurations |
| :--- | :--- | :--- |
| **Welcome Banner** | Greeting by time of day, custom nickname, live clock (optional seconds), weather forecast, vault stats, countdown badge, and customizable background image. | Weather provider (CMA Station / Open-Meteo / QWeather), city/district selection, background mask, field toggles, vault founding date, target date. |
| **Recent Notes** | Fast access to recently modified or newly created notes with folder paths. | Note count limit, include/exclude folders, sort order, display folder option. |
| **Quick Access** | Pinned notes, folders, attachments, or **websites** as interactive icon tiles; website entries auto-fetch favicons and page titles. | Path/URL autocomplete, display name, Lucide icon picker, custom order, column count. |
| **Countdown & Anniversaries** | Accurate day count tracking remaining days to goals or elapsed days from anniversaries. | Target date, counting direction (past / future), description and subtitle. |
| **Pomodoro Clock** | Focus, short break, and long break cycle timer with progress ring and daily/weekly completion statistics. Timers persist across note switches and restarts. **Completing a focus session can automatically check off a linked habit.** | Stage durations, long break frequency, auto-start breaks, sound alerts, system notifications, linked habit. |
| **Daily Quote** | Display inspiring quotes from a dedicated note (one per line) or custom quote list. | Source note path, daily rotation vs. random, custom quote pool. |
| **Habit Tracker** | Today's check-in checklist combined with a GitHub-style activity heatmap (week / month / year, cells auto-size to fill card height), plus the current streak. | Habit items list, storage mode (local plugin data / Daily Note / **monthly notes folder**). |
| **Mistakes Reviewer** | Draws random questions from a mistake-notes folder, rotating across subjects with per-day progress; question images support click-to-zoom lightbox (wheel zoom / pinch zoom / drag to pan). | Root folder, included subfolders, hide answer by default. |
| **Idiom Review** | Parses an idiom-collection note, shows a random idiom with its meaning, cycles on confirm, and supports extra rounds. | Source note path. |
| **Task Kanban** | Scans `- [ ]` markdown tasks and arranges them across Todo `[ ]`, Doing `[/]`, and Done `[x]` columns. Supports drag-and-drop status changes and inline task creation. | Source file or folder, default inbox file, column headers, hide completed toggle. |
| **Vault Statistics** | Overview metrics including notes count, tags, word count, attachments, folders, vault age, created today, and modified this week. | Metric items toggle, grid column layout, exclude folders. |
| **On This Day** | Surfaces notes created or written on this day across past years. | Item count limit, date property key, filename date fallback, ctime fallback. |
| **Note Embed** | Render any note or specific heading section directly within your dashboard. | Note path, section heading, hide frontmatter toggle. |
| **Integrated Feed** *(Optional)* | Aggregated information stream combining duowei table insights, annotation inbox, and synced messages. | Source toggles, table scope, date fields, message sources. |
| **Tasks & Schedule** *(Duowei Table)* | Scans multidimensional tables (`.duowei`), surfaces overdue, today, upcoming, and recent updates with direct row navigation. | Scan scope, exclude tables, date field mappings, section day limits. |
| **WeChat Inbox** | Aggregates WeChat sync messages with text, audio transcription, and image thumbnails. | Data source, unorganized filter, days range, type filters. |
| **Annotations & Review** | Connects to Mobile Ink Annotation Pro to show inbox annotations, daily reviews, and collections. | Card statistics, thumbnail preview, one-click jump to annotation center. |
| **Media & RSS Subscriptions** | Surfaces articles from mainstream sources and personal custom RSS / OPML feeds, with two added column sources (SouthCN Opinion, YCWB Reviews) and "next page" pagination with cross-page dedup. | Channel nav style, default channel, OPML import/export, category organization, clipping folder. |

---

## 📐 Responsive 12-Column Layout

- **12-Column Adaptive Grid**: Automatically reflows and scales proportionately based on viewport width; phones get a full-width single column, while tablets in landscape keep multiple columns like desktop.
- **WYSIWYG Layout Editing**:
  - Click **Edit Layout** in the header to enter arrangement mode.
  - Drag cards with a mouse, or drag their title/grip on touchscreens. Insertion markers support rows, columns, and gaps; dragging near the view edge scrolls automatically. Press Esc to cancel.
  - Drag the corner handle to resize; width snaps to columns and height to rows, with a live size badge (height only on narrow screens, Esc cancels). Footer buttons and arrow keys on the focused handle step the size too. Edit mode shows 12 column guides.
  - Easily move forward, move backward, duplicate, or delete any widget.
- **Multi-Page Management**:
  - Click `+` at the end of the tab bar at any time to create distinct pages (e.g., "Work Dashboard", "Life Log", "Project Hub").
  - Drag page tabs to reorder in edit mode. Right-click tabs to rename, move left/right, or delete pages.
- **JSON Import & Export**: One-click copy and paste of complete dashboard layouts for easy backup and cross-vault migration.

---

## 🔌 Host API for Plugin Developers

Home Pages exposes a lightweight host API (`app.plugins.plugins["home-pages"]?.api`) allowing other Obsidian plugins to register custom widgets, pin views to the homepage, trigger dashboard redraws, and reuse the built-in UI rendering helpers.

> **Integration Example:** **Duowei Table (duowei-table-pro ≥ 1.4.0)** registers `duowei-view` via the Host API. Users can right-click any table view tab and select "Pin to Homepage".

---

## 🧩 User-Defined Custom Widgets (Folder-based & Hot-Reload)

Users can build custom widgets directly in JavaScript without creating separate plugins: set a **Custom Widgets Folder** in settings (or generate the demo template `demo-widget.js`), then export a standard widget definition from any `.js` file in that folder. New widgets appear on the current page on first load, and saving changes to the script **hot-reloads the card instantly**.

---

## 📥 Installation

This customized fork is not published to the Obsidian Community Plugins directory. Install it manually:

1. Download the latest release assets from [this repo's Releases page](https://github.com/1396656/home-pages-custom/releases):
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Locate or create your plugin folder inside your vault:
   ```text
   <vault>/.obsidian/plugins/home-pages/
   ```
3. Copy the downloaded files into that directory.
4. Reload Obsidian and enable **Home Pages** in **Settings → Community plugins**.

---

## 🖊️ Usage

1. **Opening Home Pages**:
   - Click the homepage icon on the left ribbon.
   - Or press `Ctrl/Cmd + P` and execute the command `Home Pages: Open Homepage`.
2. **Customizing Layout & Widgets**:
   - Click **Edit Layout** in the top-right corner of the view.
   - Click **Add Widget** at the top to select and insert any widget.
   - Click the **Gear** icon on any card header to customize its parameters (weather city, habit list, stats filters, etc.).
3. **Global Settings**:
   - Navigate to Obsidian **Settings → Home Pages**.
   - Configure auto-open on startup, default row height (px), grid gap, maximum width, and manage pages.

---

## ⚙️ Settings Reference

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Open on startup** | Automatically open homepage when Obsidian launches | On |
| **Open in new tab** | Open homepage in a new tab instead of replacing active tab | On |
| **Row height** | Unit height for grid rows in pixels (24px - 96px) | 40px |
| **Grid gap** | Spacing between widget cards in pixels (4px - 40px) | 16px |
| **Max content width** | Max width constraint (0 fills window width) | 1400px |
| **Always show page tabs** | Keep page tabs visible even with single page | On (new installs) |
| **Add new custom widgets automatically** | Put a custom widget on the current page the first time its script loads | On |
| **Page management** | Add, duplicate, rename, or remove homepage layouts | Default page |
| **Import / Export** | Copy or paste full dashboard layouts in JSON format | - |

---

## 🔒 Data & Privacy

- **100% Local Storage:** All dashboard configurations, layout JSONs, pomodoro records, and habits are stored locally in `data.json`.
- **Zero Telemetry:** The plugin does not collect usage analytics, telemetry, or user metrics.
- **Network Requests:** Weather queries are only initiated when a weather-enabled banner is rendered:
  - CMA Station requests public endpoints without keys.
  - Open-Meteo and QWeather only connect when explicitly selected and configured.
- **Bundle Integrity:** A fail-closed security gate (`scripts/verify-bundle.mjs`) ensures the distributed bundle contains no dynamic script generation, `eval()`, or `new Function()`.

---

## ❓ FAQ

### Will layout break on mobile devices?
No. Phones automatically get a full-width single-column layout, while tablets keep the multi-column layout (landscape behaves like desktop). Card internals adapt to card width, and touch targets are enlarged for touchscreens.

### Does the Pomodoro timer keep running if I switch notes or restart Obsidian?
Yes. The timer state and start timestamp are persisted in plugin memory and data. Switching views or restarting Obsidian restores the timer seamlessly.

### How do I restore the default initial layout?
In **Settings → Home Pages → Pages**, click **＋ New Default Page** at any time to generate a clean instance of the default layout.

---

## 🧑‍💻 Development

Contributions and pull requests are welcome!

```bash
# 1. Install dependencies
npm install

# 2. Start dev build with watch mode
npm run dev

# 3. Lint source code
npm run lint

# 4. Production build with security audit
npm run build
```

---

## 📋 Release Notes

For detailed changelogs and version release histories, see [RELEASE_NOTES.md](RELEASE_NOTES.md) (or [RELEASE_NOTES.zh-CN.md](RELEASE_NOTES.zh-CN.md)).

---

## 🤝 Support & Feedback

- **Bug Reports & Feature Requests — [this repository's issue tracker](https://github.com/1396656/home-pages-custom/issues).** Please include your Obsidian version, operating system, and reproduction steps whenever possible.
- For issues with the original project, please visit the upstream repository [jepicaju862-lab/home-pages](https://github.com/jepicaju862-lab/home-pages).

---

## 📄 License

This project is licensed under the [GNU General Public License v3.0](LICENSE).
