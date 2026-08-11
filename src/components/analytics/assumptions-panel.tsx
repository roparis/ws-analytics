"use client";

import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type RangeOption, Segmented } from "@/components/ui/range-pills";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/metrics";
import {
	type ContributionFrequency,
	type ContributionPlan,
	monthlyAmount,
} from "@/lib/projection";
import { cn } from "@/lib/utils";
import {
	type ProjectionMode,
	type ProjectionRates,
	useProjectionStore,
} from "@/stores/projection";

/**
 * Everything the reader gets to change, tucked inside the projection card.
 *
 * Sliders rather than number fields for the rates: the useful move here is
 * sweeping a value to watch the curve respond, not entering a figure to two
 * decimal places. Money is the exception — a balance, a contribution and a
 * contribution room are all figures someone reads off a statement, so they get
 * typed.
 *
 * The two contribution tabs are the same question asked at two levels of
 * detail. Simple splits one monthly figure across the accounts by weight;
 * advanced lets each account carry its own amount, its own pay cycle and its
 * own contribution room. Only contributions differ — the horizon, the rates and
 * the starting balances sit outside the tabs, because they are the same
 * assumption whichever way the money goes in.
 */

const FREQUENCIES: readonly RangeOption<ContributionFrequency>[] = [
	{ value: "weekly", label: "Weekly" },
	{ value: "biweekly", label: "Bi-weekly" },
	{ value: "monthly", label: "Monthly" },
];

/** The `Select` can't carry null, so "nowhere" needs a value of its own. */
const NO_OVERFLOW = "__none__";

interface AssumptionRowProps {
	label: string;
	hint: string;
	display: string;
	max: number;
	min: number;
	step: number;
	value: number;
	onChange: (value: number) => void;
}

function AssumptionRow({
	display,
	hint,
	label,
	max,
	min,
	onChange,
	step,
	value,
}: AssumptionRowProps) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between gap-3">
				<span className="font-medium text-sm">{label}</span>
				<span className="font-semibold text-sm tabular-nums">{display}</span>
			</div>
			<Slider
				aria-label={label}
				max={max}
				min={min}
				onValueChange={onChange}
				step={step}
				value={value}
			/>
			<span className="text-muted-foreground text-xs">{hint}</span>
		</div>
	);
}

interface MoneyInputProps {
	value: number | null;
	onChange: (value: number | null) => void;
	id?: string;
	"aria-label"?: string;
	placeholder?: string;
	className?: string;
}

/**
 * A money field that keeps its own text while it is being typed in.
 *
 * Rendering `String(value)` straight back would make "12." parse to 12 and
 * erase the decimal point the moment it was typed — the number is the source of
 * truth for the projection, the string is the source of truth for the caret.
 * An empty field reports null, which each caller reads its own way: no
 * override, no limit, or nothing going in.
 */
function MoneyInput({
	className,
	id,
	onChange,
	placeholder,
	value,
	...props
}: MoneyInputProps) {
	const [draft, setDraft] = useState<string | null>(null);

	return (
		<Input
			aria-label={props["aria-label"]}
			className={cn("text-right tabular-nums", className)}
			id={id}
			inputMode="decimal"
			onBlur={() => setDraft(null)}
			onChange={(event) => {
				const text = event.target.value;
				setDraft(text);
				const next = Number(text);
				onChange(text === "" || !Number.isFinite(next) ? null : next);
			}}
			placeholder={placeholder}
			type="number"
			value={draft ?? (value === null ? "" : String(value))}
		/>
	);
}

/**
 * A label above its control, for the grid inside an advanced plan.
 *
 * `htmlFor` is optional because one of these controls is a row of buttons
 * rather than a field: a `<label for>` pointing at something unlabelable would
 * be worse than the group's own `aria-label`.
 */
function Field({
	children,
	className,
	htmlFor,
	label,
}: {
	children: React.ReactNode;
	className?: string;
	htmlFor?: string;
	label: string;
}) {
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			{htmlFor ? (
				<label className="text-muted-foreground text-xs" htmlFor={htmlFor}>
					{label}
				</label>
			) : (
				<span className="text-muted-foreground text-xs">{label}</span>
			)}
			{children}
		</div>
	);
}

interface StartingBalanceRowProps {
	accountType: string;
	currency: string;
	/** What the files say, before any override. */
	derived: number;
	/** What is actually being projected from. */
	value: number;
	overridden: boolean;
	onChange: (value: number | null) => void;
}

function StartingBalanceRow({
	accountType,
	currency,
	derived,
	onChange,
	overridden,
	value,
}: StartingBalanceRowProps) {
	const inputId = useId();

	return (
		<div className="flex items-center gap-3">
			<label
				className="min-w-0 flex-1 truncate text-sm"
				htmlFor={inputId}
				title={accountType}
			>
				{accountType}
			</label>
			<MoneyInput
				className="w-32"
				id={inputId}
				onChange={onChange}
				value={value}
			/>
			<Button
				aria-label={`Reset ${accountType} to ${formatCurrency(derived, currency)}`}
				className={overridden ? undefined : "invisible"}
				onClick={() => onChange(null)}
				size="xs"
				variant="ghost"
			>
				<RotateCcw className="size-3" />
			</Button>
		</div>
	);
}

interface PlanRowProps {
	accountType: string;
	currency: string;
	plan: ContributionPlan;
	/** The other accounts, as overflow targets. */
	others: string[];
	/** The calendar year this account's room runs out, if it ever does. */
	roomYear?: string;
	onChange: (patch: Partial<ContributionPlan>) => void;
}

/**
 * One account's plan: what goes in, how often, how much room is left to take
 * it, and where the money goes once there is none.
 */
function PlanRow({
	accountType,
	currency,
	onChange,
	others,
	plan,
	roomYear,
}: PlanRowProps) {
	const id = useId();
	const monthly = monthlyAmount(plan);

	return (
		<div className="flex flex-col gap-3 rounded-2xl border p-3">
			<div className="flex items-baseline justify-between gap-3">
				<span className="min-w-0 truncate font-medium text-sm">
					{accountType}
				</span>
				{plan.frequency !== "monthly" && monthly > 0 && (
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						≈ {formatCurrency(monthly, currency)} a month
					</span>
				)}
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<Field htmlFor={`${id}-amount`} label="Contribution">
					<MoneyInput
						id={`${id}-amount`}
						onChange={(value) => onChange({ amount: value ?? 0 })}
						value={plan.amount}
					/>
				</Field>
				<Field label="How often">
					<Segmented
						aria-label={`${accountType} contribution frequency`}
						inset
						onChange={(frequency) => onChange({ frequency })}
						options={FREQUENCIES}
						value={plan.frequency}
					/>
				</Field>
				<Field htmlFor={`${id}-room`} label="Contribution room">
					<MoneyInput
						id={`${id}-room`}
						onChange={(room) => onChange({ room })}
						placeholder="No limit"
						value={plan.room}
					/>
				</Field>
				<Field htmlFor={`${id}-increase`} label="Room added each year">
					<MoneyInput
						id={`${id}-increase`}
						onChange={(value) => onChange({ roomIncrease: value ?? 0 })}
						value={plan.roomIncrease}
					/>
				</Field>
				{plan.room !== null && others.length > 0 && (
					<Field
						className="sm:col-span-2"
						htmlFor={`${id}-overflow`}
						label="When the room runs out, put it in"
					>
						<Select
							items={[
								{ value: NO_OVERFLOW, label: "Nothing — stop contributing" },
								...others.map((type) => ({ value: type, label: type })),
							]}
							onValueChange={(value) =>
								onChange({
									overflowTo: value === NO_OVERFLOW ? null : String(value),
								})
							}
							value={plan.overflowTo ?? NO_OVERFLOW}
						>
							<SelectTrigger className="w-full" id={`${id}-overflow`} size="sm">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={NO_OVERFLOW}>
									Nothing — stop contributing
								</SelectItem>
								{others.map((type) => (
									<SelectItem key={type} value={type}>
										{type}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				)}
			</div>

			{roomYear && (
				<p className="text-muted-foreground text-xs">
					Room runs out in {roomYear}
					{plan.overflowTo
						? ` — the rest goes to ${plan.overflowTo} from then on.`
						: " — the rest isn't projected."}
				</p>
			)}
		</div>
	);
}

interface AssumptionsPanelProps {
	inputs: ProjectionRates;
	currency: string;
	/** Starting balances as derived from the files, before overrides. */
	derived: Record<string, number>;
	/** Starting balances actually in use. */
	balances: Record<string, number>;
	/** Where the derived figures came from, said plainly. */
	basis: string;
	/** Account type -> the calendar year its contribution room runs out. */
	roomYears: Record<string, string>;
}

export function AssumptionsPanel({
	balances,
	basis,
	currency,
	derived,
	inputs,
	roomYears,
}: AssumptionsPanelProps) {
	const setInput = useProjectionStore((state) => state.setInput);
	const setOverride = useProjectionStore((state) => state.setOverride);
	const setMode = useProjectionStore((state) => state.setMode);
	const setPlan = useProjectionStore((state) => state.setPlan);
	const overrides = useProjectionStore((state) => state.overrides);
	const mode = useProjectionStore((state) => state.mode);
	const plans = useProjectionStore((state) => state.plans);
	const reset = useProjectionStore((state) => state.reset);

	const accountTypes = Object.keys(derived).sort();
	const total = Object.values(balances).reduce((sum, value) => sum + value, 0);

	return (
		<div className="flex flex-col gap-6 border-t pt-5">
			<p className="text-muted-foreground text-sm">
				None of this is in your export — every figure below is one you chose,
				and the chart is only ever as good as they are.
			</p>

			<div className="grid gap-5 sm:grid-cols-2">
				<AssumptionRow
					display={`${inputs.years} years`}
					hint="How far ahead to project."
					label="Horizon"
					max={40}
					min={1}
					onChange={(value) => setInput("years", value)}
					step={1}
					value={inputs.years}
				/>
				<AssumptionRow
					display={`${(inputs.annualReturn * 100).toFixed(1)}%`}
					hint="Nominal, compounded monthly. Long-run equity averages sit around 7%, before fees."
					label="Annual return"
					max={0.15}
					min={-0.05}
					onChange={(value) => setInput("annualReturn", value)}
					step={0.001}
					value={inputs.annualReturn}
				/>
				<AssumptionRow
					display={`${(inputs.annualInflation * 100).toFixed(1)}%`}
					hint="Only affects the “in today's money” figure, never the nominal curve."
					label="Inflation"
					max={0.08}
					min={0}
					onChange={(value) => setInput("annualInflation", value)}
					step={0.001}
					value={inputs.annualInflation}
				/>
				<AssumptionRow
					display={`${(inputs.withdrawalRate * 100).toFixed(1)}%`}
					hint="Taken out each year as a share of the balance. Leave at 0 while you're still building."
					label="Withdrawal rate"
					max={0.2}
					min={0}
					onChange={(value) => setInput("withdrawalRate", value)}
					step={0.0025}
					value={inputs.withdrawalRate}
				/>
			</div>

			<Tabs
				className="gap-4 border-t pt-5"
				onValueChange={(value) =>
					// The balances go along so the first switch to advanced can seed a
					// plan per account instead of handing over a blank form.
					setMode(value as ProjectionMode, balances)
				}
				value={mode}
			>
				<div className="flex flex-wrap items-baseline justify-between gap-3">
					<span className="font-medium text-sm">Contributions</span>
					<TabsList>
						<TabsTrigger value="simple">Simple</TabsTrigger>
						<TabsTrigger value="advanced">Advanced</TabsTrigger>
					</TabsList>
				</div>

				<TabsContent value="simple">
					<AssumptionRow
						display={formatCurrency(inputs.monthlyContribution, currency)}
						hint="Split across your accounts in proportion to what each already holds."
						label="Monthly contribution"
						max={5000}
						min={0}
						onChange={(value) => setInput("monthlyContribution", value)}
						step={25}
						value={inputs.monthlyContribution}
					/>
				</TabsContent>

				<TabsContent className="flex flex-col gap-3" value="advanced">
					<p className="text-muted-foreground text-xs">
						A pay cycle and a contribution room per account. Room carries
						forward: what you don't use this year is still there next year, and
						a withdrawal doesn't give any of it back.
					</p>
					{accountTypes.map((accountType) => (
						<PlanRow
							accountType={accountType}
							currency={currency}
							key={accountType}
							onChange={(patch) => setPlan(accountType, patch)}
							others={accountTypes.filter((type) => type !== accountType)}
							plan={
								plans[accountType] ?? {
									amount: 0,
									frequency: "monthly",
									room: null,
									roomIncrease: 0,
									overflowTo: null,
								}
							}
							roomYear={roomYears[accountType]}
						/>
					))}
				</TabsContent>
			</Tabs>

			<div className="flex flex-col gap-3 border-t pt-5">
				<div className="flex items-baseline justify-between gap-3">
					<span className="font-medium text-sm">Starting from</span>
					<span className="font-semibold text-sm tabular-nums">
						{formatCurrency(total, currency)}
					</span>
				</div>
				<p className="text-muted-foreground text-xs">{basis}</p>

				<div className="flex flex-col gap-2">
					{accountTypes.map((accountType) => (
						<StartingBalanceRow
							accountType={accountType}
							currency={currency}
							derived={derived[accountType]}
							key={accountType}
							onChange={(value) => setOverride(accountType, value)}
							overridden={accountType in overrides}
							value={balances[accountType] ?? 0}
						/>
					))}
				</div>
			</div>

			<Button className="self-start" onClick={reset} size="sm" variant="ghost">
				<RotateCcw className="size-3.5" />
				Reset everything
			</Button>
		</div>
	);
}
