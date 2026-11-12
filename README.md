# Copy Rights ©

*It's on my screen. It's in the page source on my disk. I'm copying it.*

A Firefox extension that stops websites from messing with how you read and
copy text. It's **on everywhere by default**. Turn it off for a site with one
click when a web app really needs its own behaviour.

Inspired by [Don't F*** With Paste](https://github.com/abg1979/dont-fuck-with-paste),
which only unblocks copy/cut/paste, only on sites you opt in, and (per its own
README) leaves right-click alone. Copy Rights covers a lot more.

## What it defeats

| Trick | How Copy Rights handles it |
|---|---|
| Right-click blocked or replaced with a custom menu | You always get the native context menu |
| `user-select: none` (even `!important`, even inline) | Overridden with a *user-origin* stylesheet, which beats page `!important` |
| `selectstart` / `dragstart` blocking | Page never sees the event |
| Invisible selection highlight (`::selection { background: transparent }`) | Forced back to the system highlight colours |
| Copy/cut blocking, "copying is not allowed" alerts | Page never sees the event, so the browser copies |
| "Read more at https://…" appended to copied text | Same: you get exactly what you selected |
| Paste blocked in inputs (`paste`, `beforeinput`, `drop`, Ctrl+V / Ctrl+Shift+V / Shift+Insert keydown, `onpaste="return false"`) | Page never sees it |
| "Confirm your email": page lets the paste land, then wipes the field (in an `input` handler or on a timer) | Your pasted value is put back (with `input`/`change` events so frameworks like React pick it up). A page that only *reformats* your paste (phone numbers, upper-casing) is left alone |
| "Share this quote / Tweet this / Ask AI" popups on selection | `mouseup`/`pointerup`/`touchend`/`selectionchange` are hidden from the page while text is selected (clicks on buttons and links still work) |
| Ctrl+U (view source), F12, Ctrl+Shift+I/J/C/K, Ctrl+C/X/A hijacked | Page never sees those keys |
| Inline `oncontextmenu="return false"` and similar | Never run: our listener goes first |

### How it works

A content script runs at `document_start` in every frame, before any page
script exists, and adds **capture listeners on `window`**. Those are the first
listeners on every event's path. When they call `stopImmediatePropagation()`,
no page handler (whether `addEventListener`, `on*` properties or inline
attributes) ever runs, and the browser's default behaviour wins. Shadow DOM
targets are followed through `composedPath()`.

CSS goes in through `scripting.insertCSS({ origin: "USER" })`, so its
`!important` rules beat the page's.

### What's deliberately left alone

Rich editors (`contenteditable`, e.g. Google Docs, Notion, Slack) handle
copy/paste themselves. If the selection or focus is inside one, clipboard
events pass through so the app keeps working. Plain `<input>`/`<textarea>`
fields are where "no pasting your email twice" lives, so those *are* guarded:
you paste where you want, when you want.
Elements with `draggable="true"` (real drag-and-drop UIs) keep their drag
events.

If a site breaks (a map, a design tool, a code editor that wants its own
right-click), open the popup and click **"Let *site* do its thing"**. This
covers subdomains, applies live and needs no reload. The popup also has a
master on/off switch.

### Known gaps

- Scripts that clear your selection on a timer (`removeAllRanges()` in a loop).
- Transparent overlay `div`s laid on top of text.
- Text rendered to `<canvas>` or images. Nothing to select there; use the source or OCR.

## Firefox has some of this built in

You may not even need an extension for some of this:

- **Shift + right-click** always opens Firefox's native context menu.
- `about:config` → `dom.event.contextmenu.enabled = false` disables right-click blocking everywhere.
- `about:config` → `dom.event.clipboardevents.enabled = false` disables *all*
  page clipboard events. This breaks copy/paste in Google Docs and similar apps,
  which is why Copy Rights is selective instead.

## Install

Unsigned extensions only stay installed in Firefox Developer Edition/Nightly
(with `xpinstall.signatures.required = false`). On regular Firefox:

- **Try it:** `about:debugging#/runtime/this-firefox` → *Load Temporary
  Add-on…* → pick `manifest.json`. It stays until Firefox restarts.
- **Keep it:** sign it as an unlisted (self-distributed) add-on with your free
  [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/), then
  install the resulting `.xpi`:
  ```sh
  npx web-ext sign --channel=unlisted --api-key=$AMO_JWT_ISSUER --api-secret=$AMO_JWT_SECRET \
    --ignore-files 'test/**' 'node_modules/**' package.json package-lock.json README.md
  ```

## Develop

```sh
npm install
npm start      # Firefox with the extension loaded, on the torture page
npm test       # headless Firefox end-to-end test against test/torture.html
npm run lint
npm run build  # zip in web-ext-artifacts/
```

`test/torture.html` uses every trick above at once. Open it with and without
the extension to see the difference.

## License

MIT
