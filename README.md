# ws-analytics

Upload a CSV, explore it as charts and tables, and export a PDF report — entirely in your browser.

There's no backend and no database: parsing, charting, and rendering all happen client-side, so your data never leaves your machine. This is the open-source core, free to self-host.

## Getting started

Requires [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000), then drop in a CSV file.

## How it works

- **Upload** — drag and drop or pick a `.csv` file; it's parsed in the browser with [Papaparse](https://www.papaparse.com/).
- **Explore** — columns are auto-typed (number / date / text), and you get a sortable, paginated table plus an auto-generated chart with column pickers.
- **Export** — the "Export PDF" button snapshots the current chart and table into a downloadable PDF report.

## Tech stack

- [Next.js](https://nextjs.org) (App Router) + React
- [Tailwind CSS](https://tailwindcss.com) v4
- [shadcn](https://ui.shadcn.com) components on [Base UI](https://base-ui.com)
- [Recharts](https://recharts.org) for charts, [TanStack Table](https://tanstack.com/table) for the data table
- [Biome](https://biomejs.dev) for linting/formatting

## Scripts

| Command             | Description                     |
| -------------------- | -------------------------------- |
| `pnpm dev`           | Start the dev server             |
| `pnpm build`         | Production build                 |
| `pnpm check`         | Lint/format check (Biome)        |
| `pnpm check:write`   | Lint/format check with autofix   |
| `pnpm typecheck`     | TypeScript type check            |
