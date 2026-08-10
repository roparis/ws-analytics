"use client";

import { RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { formatCurrency } from "@/lib/metrics";
import type { ProjectionInputs } from "@/lib/projection";
import { useProjectionStore } from "@/stores/projection";

/**
 * Everything the reader gets to change, in one place.
 *
 * Sliders rather than number fields for the rates: the useful move here is
 * sweeping a value to watch the curve respond, not entering a figure to two
 * decimal places. The starting balances are the exception — those are real
 * amounts someone reads off their account, so they get typed.
 */

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

	// The field keeps its own text while it is being typed in. Rendering
	// `String(value)` straight back would make "12." parse to 12 and erase the
	// decimal point the moment it was typed — the number is the source of truth
	// for the projection, the string is the source of truth for the caret.
	const [draft, setDraft] = useState<string | null>(null);

	return (
		<div className="flex items-center gap-3">
			<label
				className="min-w-0 flex-1 truncate text-sm"
				htmlFor={inputId}
				title={accountType}
			>
				{accountType}
			</label>
			<Input
				className="w-32 text-right tabular-nums"
				id={inputId}
				inputMode="decimal"
				onBlur={() => setDraft(null)}
				onChange={(event) => {
					const text = event.target.value;
					setDraft(text);
					const next = Number(text);
					onChange(text === "" || !Number.isFinite(next) ? null : next);
				}}
				type="number"
				value={draft ?? String(value)}
			/>
			<Button
				aria-label={`Reset ${accountType} to ${formatCurrency(derived, currency)}`}
				className={overridden ? undefined : "invisible"}
				onClick={() => {
					setDraft(null);
					onChange(null);
				}}
				size="xs"
				variant="ghost"
			>
				<RotateCcw className="size-3" />
			</Button>
		</div>
	);
}

interface AssumptionsPanelProps {
	inputs: ProjectionInputs;
	currency: string;
	/** Starting balances as derived from the files, before overrides. */
	derived: Record<string, number>;
	/** Starting balances actually in use. */
	balances: Record<string, number>;
	/** Where the derived figures came from, said plainly. */
	basis: string;
}

export function AssumptionsPanel({
	balances,
	basis,
	currency,
	derived,
	inputs,
}: AssumptionsPanelProps) {
	const setInput = useProjectionStore((state) => state.setInput);
	const setOverride = useProjectionStore((state) => state.setOverride);
	const overrides = useProjectionStore((state) => state.overrides);
	const reset = useProjectionStore((state) => state.reset);

	const accountTypes = Object.keys(derived).sort();
	const total = Object.values(balances).reduce((sum, value) => sum + value, 0);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Assumptions</CardTitle>
				<CardDescription>
					None of this is in your export — every figure below is one you chose,
					and the chart is only ever as good as they are.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-6">
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
						display={formatCurrency(inputs.monthlyContribution, currency)}
						hint="Split across your accounts in proportion to what each already holds."
						label="Monthly contribution"
						max={5000}
						min={0}
						onChange={(value) => setInput("monthlyContribution", value)}
						step={25}
						value={inputs.monthlyContribution}
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

				<Button
					className="self-start"
					onClick={reset}
					size="sm"
					variant="ghost"
				>
					<RotateCcw className="size-3.5" />
					Reset everything
				</Button>
			</CardContent>
		</Card>
	);
}
