import { describe, expect, it } from "vitest";
import { once } from "@/lib/once";

/** A promise plus the callback that settles it, so a test can hold a call
 * open across several `await`s without a timer. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("once", () => {
	it("runs the wrapped function once for two concurrent callers, and both get the same value", async () => {
		let calls = 0;
		const gate = deferred<number>();
		const wrapped = once(async () => {
			calls++;
			return gate.promise;
		});

		const a = wrapped();
		const b = wrapped();
		gate.resolve(42);

		await expect(a).resolves.toBe(42);
		await expect(b).resolves.toBe(42);
		expect(calls).toBe(1);
	});

	it("still runs once for many concurrent callers", async () => {
		let calls = 0;
		const gate = deferred<string>();
		const wrapped = once(async () => {
			calls++;
			return gate.promise;
		});

		const callers = Array.from({ length: 10 }, () => wrapped());
		gate.resolve("done");

		await Promise.all(callers);
		expect(calls).toBe(1);
	});

	it("runs again on a sequential call made after the first has settled", async () => {
		let calls = 0;
		const wrapped = once(async () => {
			calls++;
			return calls;
		});

		await expect(wrapped()).resolves.toBe(1);
		await expect(wrapped()).resolves.toBe(2);
		expect(calls).toBe(2);
	});

	it("rejects every concurrent caller when the run fails", async () => {
		const gate = deferred<never>();
		const wrapped = once(() => gate.promise);

		const a = wrapped();
		const b = wrapped();
		const failure = new Error("boom");
		gate.reject(failure);

		await expect(a).rejects.toBe(failure);
		await expect(b).rejects.toBe(failure);
	});

	it("lets a later call retry after a rejection, rather than replaying the cached failure", async () => {
		let calls = 0;
		const wrapped = once(async () => {
			calls++;
			if (calls === 1) throw new Error("first attempt fails");
			return "recovered";
		});

		await expect(wrapped()).rejects.toThrow("first attempt fails");
		await expect(wrapped()).resolves.toBe("recovered");
		expect(calls).toBe(2);
	});

	it("gives concurrent callers the identical object reference, not equal copies", async () => {
		const gate = deferred<{ tag: string }>();
		const wrapped = once(async () => gate.promise);

		const a = wrapped();
		const b = wrapped();
		const value = { tag: "shared" };
		gate.resolve(value);

		const [resultA, resultB] = await Promise.all([a, b]);
		expect(resultA).toBe(value);
		expect(resultB).toBe(value);
		expect(resultA).toBe(resultB);
	});
});
