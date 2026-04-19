# Let's Talk Books

> Map your Audible listening as interactive streamgraphs over time.

A desktop app that connects to your Audible account, fetches your library, and turns it into beautiful interactive visualizations:

- **Author Flow** — streamgraph of authors over time, with a genre-sorted sidebar for toggling authors on/off
- **Genre Flow** — how your reading interests shifted across years
- **Author Timeline** — dots colored by series so you can see binge-reading patterns
- **Series Timeline** — your longest-running series laid out horizontally
- **All Authors** — top 40 authors with color-coded series dots

## Privacy

Your data stays on your computer. This app talks directly from your machine to Audible — nothing is uploaded anywhere, no account info ever leaves your laptop.

## Prerequisites

- macOS, Windows, or Linux
- **Python 3** (most systems have this — the app checks on first run)
- Internet connection for the Audible login + library fetch

## Run from source

```bash
git clone <this repo>
cd lets-talk-books-app
npm install
npm start
```

The app checks for `audible-cli` (the open-source tool it uses under the hood) and offers a one-click install if it's missing.

## Build for distribution

```bash
npm run build:mac     # .dmg + .zip
npm run build:win     # .exe installer
npm run build:linux   # .AppImage
```

Output goes to `dist/`.

## How it works

1. On first run, the app verifies Python and installs [`audible-cli`](https://github.com/mkb79/audible-cli) into your user Python environment
2. Clicking "Connect to Audible" opens a browser window for Amazon login — you sign in exactly like you would on audible.com
3. After login, the app fetches your library as a TSV, parses it to JSON, and caches it locally in the app's user data folder
4. The visualizations are pure D3.js, rendering on your local data

## Data location

- **macOS:** `~/Library/Application Support/lets-talk-books/library_data.json`
- **Windows:** `%APPDATA%\lets-talk-books\library_data.json`
- **Linux:** `~/.config/lets-talk-books/library_data.json`

The Audible auth tokens live in `~/.audible/` (managed by `audible-cli`).

## Troubleshooting

**"externally-managed-environment" error on install**

Some Linux distros and newer macOS Python installs block pip. The app will suggest:
```bash
pip3 install --user --break-system-packages audible-cli
```

**Login hangs or fails**

Try running `audible quickstart` directly in a terminal, choose "external browser" login, and come back to the app — it will pick up the existing auth.

**Library export fails**

Reset and start over from the app menu, or delete `~/.audible/` and the app's data folder.

## Credits

- [audible-cli](https://github.com/mkb79/audible-cli) by mkb79 — the hard work of reverse-engineering Audible's API
- [D3.js](https://d3js.org/) — the visualization library

## License

MIT
