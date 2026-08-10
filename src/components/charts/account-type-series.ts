import type { ChartConfig } from "@/components/ui/chart";

/**
 * Turns the dataset's account types into chart series.
 *
 * Two problems this solves. First, account types are free-form labels out of
 * the CSV — "Non-registered margin" can't be a `--color-*` custom property, so
 * each type gets a positional key and carries its real name as the label.
 * Second, the palette has to be fixed in advance: the rest of the app hand-picks
 * a light/dark hex pair per series rather than leaning on the `--chart-*` ramp,
 * which is monochrome here.
 */

/**
 * The app's established series colours, in the order the other charts use them.
 * Each step is chosen against its own surface rather than flipped, and the set
 * is checked for colour-vision separation — stacked areas put any two of them
 * next to each other.
 */
const PALETTE = [
	{ light: "#0284c7", dark: "#2b95dd" },
	{ light: "#059669", dark: "#0aa876" },
	{ light: "#7c3aed", dark: "#8b5cf6" },
	{ light: "#d97706", dark: "#f59e0b" },
	{ light: "#dc2626", dark: "#ef4444" },
	{ light: "#64748b", dark: "#94a3b8" },
] as const;

export interface AccountTypeSeries {
	/** The data key and `--color-*` suffix. Positional, so it is always safe. */
	key: string;
	/** The label shown in legends and tooltips. */
	accountType: string;
}

/**
 * One series per account type, in the order given. Sort before calling if the
 * order matters — the colour assignment follows the input, so a stable sort
 * keeps a type the same colour between renders.
 */
export function buildSeries(accountTypes: string[]): AccountTypeSeries[] {
	return accountTypes.map((accountType, index) => ({
		key: `type${index}`,
		accountType,
	}));
}

export function seriesConfig(series: AccountTypeSeries[]): ChartConfig {
	const config: ChartConfig = {};
	for (const [index, item] of series.entries()) {
		config[item.key] = {
			label: item.accountType,
			// More account types than colours wraps rather than running out. Six is
			// already more than a legend reads well at.
			theme: { ...PALETTE[index % PALETTE.length] },
		};
	}
	return config;
}

/** A compact currency tick, as every other chart in the app formats its axis. */
export function compactCurrency(currency: string): (value: number) => string {
	return (value: number) =>
		new Intl.NumberFormat("en-CA", {
			style: "currency",
			currency,
			notation: "compact",
			maximumFractionDigits: 1,
		}).format(value);
}
