# PowerNotes

Outline-style Markdown notes with tasks, tags, dates and an agenda, working on a folder of `.md` files the way Obsidian does. It is a static web app: no build step, no dependencies, and it runs from any static server (or straight from `file://`, without the offline and install features).

Press **F1** in the app for the full list of shortcuts.

## Layout

| Path | What it holds |
|---|---|
| `index.html` | The markup only: header, sidebar, pane template, dialogs, and the script tags in load order |
| `css/app.css` | All styles |
| `sw.js` | Service worker: precaches the shell and fetches scripts network-first so a deploy shows on the next load |
| `js/state.js` | Element lookups, constants, the `settings` object, closed-tab history |
| `js/idb.js` | IndexedDB helpers (file handles, recent files, workspaces, the folder index cache) |
| `js/model.js` | The line model: parsing and building lines, inline Markdown, dates, front matter, link targets |
| `js/panes.js` | Shared pane state (`panes`, `activePane`), splitting, closing and laying out panes |
| `js/pane.js` | `makePane`: one editor with its tabs, caret, history, find, agenda and source view |
| `js/media.js` | Images under rows and the `Attachments` folder |
| `js/shared.js` | Find bar, filter bar, autocomplete sources and agenda items shared by all panes |
| `js/palette.js` | Command palette and quick switcher |
| `js/disk.js` | Renaming files on disk and the folder handles that makes possible |
| `js/vault.js` | The open folder: scanning, the note index, following changes, autosave, moving and trashing |
| `js/files.js` | The Files view of the sidebar |
| `js/sidebar.js` | The sidebar itself: which view shows, collapsing, the overlay on narrow screens |
| `js/search.js` | Search across the folder |
| `js/tags.js` | The Tags view |
| `js/daily.js` | Daily notes and templates |
| `js/attachments.js` | The unused-attachments dialog |
| `js/workspaces.js` | Workspaces and remembered folders |
| `js/menus.js` | The menus and context menus |
| `js/app.js` | Settings dialog, global shortcuts, file open and drop, persistence, start-up, PWA hooks |

The scripts are plain classic scripts sharing one global scope, loaded in the order listed in `index.html`. A top-level `const` or `function` in one file is visible to every later file, and functions may call into later files as long as the call happens after load (everything runs from `init()` in `app.js` or from events). When adding a script, list it in `index.html` and in the `SHELL` array of `sw.js`, and bump `VERSION` there.

## Releasing

Bump `APP_VERSION` in `js/state.js` and `VERSION` in `sw.js`. The new worker precaches the shell and takes over on the next load; the page reloads itself when nothing is unsaved.
