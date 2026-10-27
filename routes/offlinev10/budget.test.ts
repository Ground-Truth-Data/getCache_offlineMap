import { afterEach, describe, expect, it, vi } from "vitest";
import { BUDGET_MB, budgetMb, setBudgetMb } from "./budget";

// The dev CONFIG card's 16–256 MB override lives in this tab's sessionStorage and nowhere else.
describe("the dev budget override", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		setBudgetMb(BUDGET_MB);
	});

	it("is read in dev and cleared by choosing 1 GB again", () => {
		setBudgetMb(16);
		expect(budgetMb()).toBe(16);
		setBudgetMb(BUDGET_MB);
		expect(budgetMb()).toBe(1024);
		expect(sessionStorage.getItem("gc-offlineV10:budgetMb")).toBeNull();
	});

	it("never reaches a shipped build, even when one is left set", () => {
		setBudgetMb(16);
		vi.stubEnv("DEV", false);
		expect(budgetMb()).toBe(1024);
	});
});
