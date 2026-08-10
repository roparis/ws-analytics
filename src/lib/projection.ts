/**
 * A compound-growth model over the account types the export contains.
 *
 * Everything here is an assumption, not a measurement. The activities export
 * carries no prices and no forward-looking information whatsoever, so this
 * module never reads a `Activity` — it takes a starting balance per account
 * type and a set of inputs the reader chose, and compounds them. The page's job
 * is to keep saying so; this module's job is to be arithmetic anyone can check.
 *
 * Kept free of React and of `@/lib/positions` so it runs under vitest's node
 * environment, where the rest of the app's maths is tested.
 */

/** The reader's assumptions. Rates are ratios, not percentages: 0.07 is 7%. */
export interface ProjectionInputs {
	/** Horizon in years. */
	years: number;
	/** Nominal annual return, compounded monthly. */
	annualReturn: number;
	/** Added every month, split across account types by their current weight. */
	monthlyContribution: number;
	/** Deflates the "in today's money" line. 0 leaves it equal to the nominal. */
	annualInflation: number;
	/** Taken out each year as a share of the balance. 0 means still accumulating. */
	withdrawalRate: number;
}

export interface ProjectionPoint {
	/** Years from today. 0 is the starting balance, before any growth. */
	year: number;
	/** `YYYY-MM-DD` for the axis — the anniversary of the projection's start. */
	date: string;
	/** Balance per account type. Keys match the starting-balance map's. */
	byType: Record<string, number>;
	total: number;
	/** `total` deflated by `annualInflation` — what it buys in today's money. */
	totalReal: number;
	/** Starting balances plus every contribution so far, minus withdrawals. */
	contributed: number;
	/** Cash taken out so far. Positive magnitude. */
	withdrawn: number;
}

export type StartingBalances = Record<string, number>;

/** Compounding steps per year. Monthly, to match how contributions are made. */
const STEPS_PER_YEAR = 12;

/**
 * Contribution weights across account types.
 *
 * Proportional to the current balance, so a reader who sets one monthly figure
 * gets it spread the way their money already sits rather than split evenly
 * across accounts they barely use. When every balance is zero (or negative, as
 * a margin account can be) the split falls back to even — there is no
 * information to weight by, and refusing to contribute at all would be worse.
 */
export function contributionWeights(
	starting: StartingBalances,
): Record<string, number> {
	const types = Object.keys(starting);
	if (types.length === 0) return {};

	const positive = types.map((type) => Math.max(starting[type], 0));
	const total = positive.reduce((sum, value) => sum + value, 0);

	if (total <= 0) {
		const even = 1 / types.length;
		return Object.fromEntries(types.map((type) => [type, even]));
	}

	return Object.fromEntries(
		types.map((type, index) => [type, positive[index] / total]),
	);
}

/** The anniversary of `start`, `years` on. Clamps Feb 29 to Feb 28. */
function anniversary(start: Date, years: number): string {
	const date = new Date(
		Date.UTC(
			start.getUTCFullYear() + years,
			start.getUTCMonth(),
			start.getUTCDate(),
		),
	);
	// A Feb 29 start rolls into Mar 1 on a non-leap year; step back a day so the
	// axis label stays in the month the reader expects.
	if (date.getUTCMonth() !== start.getUTCMonth()) {
		date.setUTCDate(0);
	}
	return date.toISOString().slice(0, 10);
}

export interface ProjectionOptions {
	/** The projection's day zero. Defaults to today; fixed in tests. */
	startDate?: Date;
}

/**
 * Compounds each account type forward, one month at a time, and samples the
 * result once a year.
 *
 * Order within a month is: grow, then contribute. Contributing first would
 * credit a full month's return to money that arrived at the end of it, which
 * overstates the outcome by roughly one month's growth on every deposit — small
 * per month, not small over thirty years.
 *
 * Withdrawals come out once a year, after that year's growth, as a share of the
 * balance then. A balance can be drawn to zero but never past it: a negative
 * projected balance is not a forecast of debt, it is the model running out of
 * road, and `contributed` would stop reconciling if it were allowed.
 */
export function projectSeries(
	starting: StartingBalances,
	inputs: ProjectionInputs,
	options: ProjectionOptions = {},
): ProjectionPoint[] {
	const types = Object.keys(starting);
	const start = options.startDate ?? new Date();
	const years = Math.max(0, Math.round(inputs.years));

	const monthlyRate = (1 + inputs.annualReturn) ** (1 / STEPS_PER_YEAR) - 1;
	const weights = contributionWeights(starting);

	const balances: Record<string, number> = { ...starting };
	let contributed = types.reduce((sum, type) => sum + starting[type], 0);
	let withdrawn = 0;

	const points: ProjectionPoint[] = [
		{
			year: 0,
			date: anniversary(start, 0),
			byType: { ...balances },
			total: sumOf(balances),
			totalReal: sumOf(balances),
			contributed,
			withdrawn: 0,
		},
	];

	for (let year = 1; year <= years; year += 1) {
		for (let month = 0; month < STEPS_PER_YEAR; month += 1) {
			for (const type of types) {
				balances[type] *= 1 + monthlyRate;
				const share = inputs.monthlyContribution * (weights[type] ?? 0);
				balances[type] += share;
				contributed += share;
			}
		}

		if (inputs.withdrawalRate > 0) {
			for (const type of types) {
				const take = Math.max(
					0,
					Math.min(balances[type], balances[type] * inputs.withdrawalRate),
				);
				balances[type] -= take;
				withdrawn += take;
			}
		}

		const total = sumOf(balances);
		points.push({
			year,
			date: anniversary(start, year),
			byType: { ...balances },
			total,
			totalReal: total / (1 + inputs.annualInflation) ** year,
			contributed,
			withdrawn,
		});
	}

	return points;
}

function sumOf(balances: Record<string, number>): number {
	return Object.values(balances).reduce((sum, value) => sum + value, 0);
}

/**
 * The first year the projection's total balance reaches zero, or null if it
 * never does. Only meaningful with a withdrawal rate set — without one the
 * balance can only fall if the return is negative.
 */
export function depletionYear(points: ProjectionPoint[]): number | null {
	const hit = points.find((point) => point.total <= 0);
	return hit ? hit.year : null;
}
