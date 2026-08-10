# ws-analytics

A lightweight open-source browser app for exploring Wealthsimple CSV data with charts, tables, and PDF export.

This repository contains the self-hosted core: your data is parsed and analysed in the browser, with no external database and no file ever uploaded.

> **On this branch (`WSA-006`)** there is one exception, and it is a proof of concept: live pricing sends *ticker symbols* — never share counts, amounts, or accounts — through this app's own server to Yahoo Finance. See [docs/yahoo-pricing-poc.md](docs/yahoo-pricing-poc.md). Without it, the app still has no backend at all.

## Quick start

Requires [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000) and upload a `.csv` file.

## Features

- Drag-and-drop or select CSV upload
- Client-side parsing with [Papaparse](https://www.papaparse.com/)
- Automatic column typing for numbers, dates, and text
- Sortable, paginated data table
- Auto-generated chart visualization with column selectors
- Export the current view as a PDF report
- Live holding prices from Yahoo Finance, or from a Google Sheets round trip
- Dark/light theme support

## How it works

1. Upload a CSV file.
2. The browser parses the file and infers column types.
3. Data is displayed in an interactive table.
4. A chart is generated from the selected columns.
5. Click `Export PDF` to download a report of the current table and chart.

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
- TanStack Table for data tables
- Zustand for client state
- Papaparse for CSV parsing
- jsPDF + html2canvas for PDF export
- Biome for linting and formatting

## Project structure

- `src/app/` — Next.js app routes and layouts
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
