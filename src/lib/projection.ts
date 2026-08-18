import { addMonths, toLocalIso } from "@/lib/calendar-date";

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

/** How often a per-account contribution is made. */
export type ContributionFrequency = "weekly" | "biweekly" | "monthly";

/** Contributions per year, by frequency. */
const PERIODS_PER_YEAR: Record<ContributionFrequency, number> = {
	weekly: 52,
	biweekly: 26,
	monthly: 12,
};

/**
 * One account's saving plan: what goes in, how often, and how much of it the
 * account is still allowed to take.
 *
 * `room` is a carry-forward pool, which is how a TFSA or an RRSP actually
 * works: it starts at what the reader has available today, grows by
 * `roomIncrease` at the start of every year after the first, and every
 * contribution draws it down. Unused room stays available rather than expiring
 * with the year.
 */
export interface ContributionPlan {
	/** Per period, not per year. */
	amount: number;
	frequency: ContributionFrequency;
	/** Room available today. `null` means the account has no limit. */
	room: number | null;
	/** Added to the room at the start of each year after the first. */
	roomIncrease: number;
	/**
	 * The account type that takes what this one's room refuses. `null` stops the
	 * money instead, and what stops is reported as `unfunded` rather than
	 * quietly dropped.
	 */
	overflowTo: string | null;
}

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
	/**
	 * Per-account saving plans. When present these *replace* the single
	 * `monthlyContribution` split — the global figure is ignored entirely, so a
	 * value left over from the simple controls can never add itself on top of
	 * the per-account ones.
	 */
	plans?: Record<string, ContributionPlan>;
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
	/** Starting balances plus every contribution so far. */
	contributed: number;
	/**
	 * `contributed`, per account type: what each one started with plus what has
	 * gone into it since. Money that overflowed counts against the account that
	 * received it, not the one that turned it away — this is where the money
	 * actually is, which is what the band above it is drawn from.
	 */
	contributedByType: Record<string, number>;
	/** Cash taken out so far. Positive magnitude. */
	withdrawn: number;
	/** Room still available, for the accounts that have a limit at all. */
	roomLeft: Record<string, number>;
	/** Cumulative contribution each account's own room turned away. */
	refused: Record<string, number>;
	/** Cumulative money no account in the overflow chain could take. */
	unfunded: number;
}

export type StartingBalances = Record<string, number>;

/** Compounding steps per year. Monthly, to match how contributions are made. */
const STEPS_PER_YEAR = 12;

/**
 * A plan's contribution per monthly step.
 *
 * The engine steps monthly, so a weekly or bi-weekly plan is spread evenly
 * across the month rather than landing on its real dates. The annual total is
 * exact — 26 bi-weekly deposits are 26, not 24 — and only the timing within a
 * year is smoothed. It is the one approximation in this module, and it is
 * smaller than the grow-then-contribute ordering below, which is itself worth
 * about a month's growth per deposit.
 */
export function monthlyAmount(plan: ContributionPlan): number {
	return (plan.amount * PERIODS_PER_YEAR[plan.frequency]) / STEPS_PER_YEAR;
}

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

/**
 * The anniversary of `start`, `years` on, as a local calendar date.
 *
 * `start` is an instant; the projection is dated by the day the reader is
 * having, so the calendar date comes from the local clock. Reading the UTC
 * components instead moved every date a day forward for anyone west of
 * Greenwich in the evening — and on New Year's Eve moved the *year*, which
 * `analytics-overview.tsx` shows as "room runs out in ⟨year⟩".
 *
 * `addMonths` clamps the day to the target month's length, which is where the
 * hand-rolled Feb 29 → Feb 28 step used to happen. That branch was itself
 * broken on a leap-day evening: the instant was already March in UTC, so it
 * compared March against March and never fired.
 */
function anniversary(start: Date, years: number): string {
	return addMonths(toLocalIso(start), years * 12);
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
 * road, and `contributed` would stop reconciling if it were allowed. Note that
 * a withdrawal does not give contribution room back, which a real TFSA does the
 * following year — the rate here is a share of the whole balance and carries no
 * per-account notion of what was taken out of where.
 *
 * With `inputs.plans` set, each account is funded by its own plan instead of by
 * a share of `monthlyContribution`, and a plan that has run out of room hands
 * what it can't take to the account it names.
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

	// Plans for account types this projection doesn't hold are dropped rather
	// than trusted: a plan left behind by a file since removed would otherwise
	// fund an account that isn't on the chart.
	const plans = inputs.plans
		? Object.fromEntries(
				Object.entries(inputs.plans).filter(([type]) => type in starting),
			)
		: null;

	const balances: Record<string, number> = { ...starting };
	const roomLeft: Record<string, number> = {};
	const refused: Record<string, number> = {};
	for (const [type, plan] of Object.entries(plans ?? {})) {
		if (plan.room !== null) roomLeft[type] = plan.room;
		refused[type] = 0;
	}

	let contributed = types.reduce((sum, type) => sum + starting[type], 0);
	const contributedByType: Record<string, number> = { ...starting };
	let withdrawn = 0;
	let unfunded = 0;

	/**
	 * Puts `amount` into `type`, and hands whatever its room refuses along the
	 * overflow chain. `visited` stops a pair of accounts pointing at each other
	 * from passing the same dollar back and forth for ever; when the chain ends
	 * without anywhere to put the money, it is counted as unfunded rather than
	 * added to an account that said no.
	 */
	function place(type: string, amount: number, visited: Set<string>): void {
		if (amount <= 0) return;
		if (!(type in balances) || visited.has(type)) {
			unfunded += amount;
			return;
		}
		visited.add(type);

		const limited = type in roomLeft;
		const accepted = limited ? Math.min(amount, roomLeft[type]) : amount;
		if (accepted > 0) {
			balances[type] += accepted;
			contributed += accepted;
			contributedByType[type] += accepted;
			if (limited) roomLeft[type] -= accepted;
		}

		const remainder = amount - accepted;
		if (remainder <= 0) return;

		refused[type] = (refused[type] ?? 0) + remainder;
		const next = plans?.[type]?.overflowTo ?? null;
		if (next === null) unfunded += remainder;
		else place(next, remainder, visited);
	}

	const points: ProjectionPoint[] = [
		{
			year: 0,
			date: anniversary(start, 0),
			byType: { ...balances },
			total: sumOf(balances),
			totalReal: sumOf(balances),
			contributed,
			contributedByType: { ...contributedByType },
			withdrawn: 0,
			roomLeft: { ...roomLeft },
			refused: { ...refused },
			unfunded: 0,
		},
	];

	for (let year = 1; year <= years; year += 1) {
		// Room arrives at the top of the year, so year one uses exactly the figure
		// the reader typed and every year after it is that plus the increase.
		if (year > 1) {
			for (const [type, plan] of Object.entries(plans ?? {})) {
				if (type in roomLeft) roomLeft[type] += plan.roomIncrease;
			}
		}

		for (let month = 0; month < STEPS_PER_YEAR; month += 1) {
			for (const type of types) {
				balances[type] *= 1 + monthlyRate;
			}

			if (plans) {
				for (const [type, plan] of Object.entries(plans)) {
					place(type, monthlyAmount(plan), new Set());
				}
			} else {
				for (const type of types) {
					const share = inputs.monthlyContribution * (weights[type] ?? 0);
					balances[type] += share;
					contributed += share;
					contributedByType[type] += share;
				}
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
			contributedByType: { ...contributedByType },
			withdrawn,
			roomLeft: { ...roomLeft },
			refused: { ...refused },
			unfunded,
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
 *
 * A projection that starts at nothing is not a depletion, so it reports null
 * rather than a year. `startingBalances` returns `{}` for an export holding
 * only cash-style accounts, which makes every year's total zero — including
 * year zero, whose total is just the sum of the starting balances. Skipping
 * year zero alone would not do: it would report year one instead. Depletion
 * means falling to zero from something, so there has to be something first.
 */
export function depletionYear(points: ProjectionPoint[]): number | null {
	const start = points[0];
	if (!start || start.total <= 0) return null;

	const hit = points.find((point) => point.total <= 0);
	return hit ? hit.year : null;
}

/**
 * The first year each account turned a contribution away, keyed by account
 * type. An account that never fills its room doesn't appear.
 *
 * Rounding guard: a plan sized to land exactly on its room can leave a
 * sub-cent remainder behind, and reporting "TFSA runs out of room in 2041" over
 * a tenth of a cent would be noise dressed as a finding.
 */
export function roomLimitYears(
	points: ProjectionPoint[],
): Record<string, number> {
	const years: Record<string, number> = {};
	for (const point of points) {
		for (const [type, amount] of Object.entries(point.refused)) {
			if (amount >= 0.01 && !(type in years)) years[type] = point.year;
		}
	}
	return years;
}

/**
 * The plans worth projecting: those for account types the dataset still has,
 * with any overflow target that has since gone pointing nowhere instead.
 *
 * Same guard as `applyOverrides` in `@/lib/analytics` — settings outlive the
 * files that justified them, and a plan naming an account nobody holds any more
 * would either fund a phantom or silently swallow the overflow.
 */
export function usablePlans(
	plans: Record<string, ContributionPlan>,
	starting: StartingBalances,
): Record<string, ContributionPlan> {
	const usable: Record<string, ContributionPlan> = {};
	for (const [type, plan] of Object.entries(plans)) {
		if (!(type in starting)) continue;
		usable[type] = {
			...plan,
			overflowTo:
				plan.overflowTo !== null && plan.overflowTo in starting
					? plan.overflowTo
					: null,
		};
	}
	return usable;
}
