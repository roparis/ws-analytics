# ws-analytics

A local-first tool for analysing a Wealthsimple activities export: cash flow, holdings, per-account and per-year analytics, retirement projections, and exports — all from a CSV, in your browser.

By default this app is fully local: your CSV is parsed and analysed in the browser, with no external database and no file ever uploaded.

Live pricing is the one exception, and it's opt-in — a button you click, not something that runs automatically. When you use it, this app's own server asks Yahoo Finance for prices; the only thing that crosses the wire is a list of ticker symbols, e.g. `["VFV.TO", "VTI"]`. Never a share count, a book cost, an account id, or a file.

| | Before live pricing | With live pricing |
|---|---|---|
| Activity CSV | Parsed in the tab, never uploaded | Unchanged — never uploaded |
| Share counts, book cost, accounts | Derived in the tab | Unchanged — never sent |
| Prices | Google Sheets, via a file you download and re-upload | Yahoo, via this app's own server process |
| What crosses the wire | Nothing | **Ticker symbols only**, e.g. `["VFV.TO", "VTI"]` |

Self-hosted (`pnpm dev`, or your own deployment), that server is your own machine, and the only outbound request is the app asking Yahoo about tickers. Deployed somewhere shared, it isn't: whoever runs that deployment can see which symbols were looked up, though never how many shares or in what account. See [docs/yahoo-pricing-poc.md](docs/yahoo-pricing-poc.md) for the detail.

## Quick start

Requires [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000) and upload a `.csv` file.

## Features

- Drag-and-drop CSV upload, parsed entirely in the browser with [Papaparse](https://www.papaparse.com/)
- Timeline and dashboard views of account activity
- Per-account and per-account-type detail pages
- Year-by-year analytics, including unrealised gain
- Retirement projections from account balances and assumptions you set
- Multi-file merge with a coverage review across accounts
- Holdings with average-cost basis and realised P&L
- Live holding prices from Yahoo Finance (opt-in), or a Google Sheets round trip
- Export an eight-tab XLSX workbook, importable straight into Google Sheets
- Export the current view as a PDF report
- Dark/light theme support

## How it works

1. Upload a CSV file — it's parsed and analysed entirely in the browser.
2. Browse the timeline, dashboard, and per-account pages, or merge in more files for a fuller history.
3. Optionally fetch live prices, or export to Google Sheets and re-import, to value holdings against current markets.
4. Export the XLSX workbook or a PDF report of the current view.

## Exporting Wealthsimple CSV data

To export your transaction data from Wealthsimple:

1. Go to **Activity**.
2. Click **Download activities**.
3. Select the desired time period.
4. Select the accounts you want to export.

Then upload the downloaded CSV into this app.

## Development

Install dependencies and start the local development server:

```bash
pnpm install
pnpm dev
```

Build for production:

```bash
pnpm build
```

Preview the production build locally:

```bash
pnpm start
```

Run static checks:

```bash
pnpm check
pnpm typecheck
```

Auto-fix formatting with Biome:

```bash
pnpm check:write
```

## Tech stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS v4
- shadcn UI components on Base UI
- Recharts for charting
- A hand-rolled data table (`src/components/data-table.tsx`) — sortable, with scroll-triggered batch loading instead of pagination
- Zustand for client state
- Papaparse for CSV parsing
- jsPDF + html2canvas-pro for PDF export (a fork used because the original chokes on this app's `oklch()` theme tokens; see `src/lib/pdf.ts`)
- Biome for linting and formatting

## Project structure

- `src/app/` — Next.js app routes and layouts
- `src/app/api/` — the only server-side code in the app: the live-pricing routes (see the privacy note above)
- `src/components/` — UI components and screens
- `src/lib/` — data parsing, metrics, PDF export, utility helpers
- `src/stores/` — application state logic
- `src/styles/` — global styles

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Open a pull request with a clear description.

Feel free to add support for more file formats, deeper charting options, or improved filtering and sorting UX.

## License

This project is open source. See the `LICENSE` file for details.
