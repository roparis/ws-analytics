/**
 * Makes an async function safe against being started twice while it is still
 * running.
 *
 * A boolean "already done" flag is not a concurrency guard when anything is
 * awaited between checking it and setting it. Two callers can both read the
 * flag as false before either has resolved its `await`, both proceed, and
 * both act — each believing itself the only one. `schemaReady` in
 * `src/lib/storage.ts` hits exactly this hazard opening the database and
 * fixes it by caching the in-flight promise instead of a boolean; this
 * generalises that fix into a reusable wrapper.
 *
 * Concurrent callers all receive the *same* promise, so the wrapped function
 * runs once and every caller sees the same settled value. The cached promise
 * is cleared as soon as it settles — on success or failure alike — so a later,
 * non-overlapping call runs again rather than replaying a stale result, and a
 * failure stays retryable instead of poisoning every call after it.
 */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
	let inFlight: Promise<T> | null = null;

	return () => {
		if (!inFlight) {
			inFlight = fn().finally(() => {
				inFlight = null;
			});
		}
		return inFlight;
	};
}
