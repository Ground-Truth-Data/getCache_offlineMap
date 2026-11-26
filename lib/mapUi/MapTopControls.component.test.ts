// @vitest-environment happy-dom
// The eye and the crow float over the map's pins. A tap that lands on one of them while a pin lies under
// the pointer is the pin's; with nothing under it, the button does its own job.
import { fireEvent, render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapHostPorts } from "../shared/mapHostPorts";
import MapTopControls from "./MapTopControls.svelte";

const onCrowToggle = vi.fn();
const pinTapped = vi.fn();

function mount() {
	const CrowSwitch = createRawSnippet<[{ onToggle: () => void }]>(() => ({
		render: () => `<button data-crow></button>`,
		setup: (el) => el.addEventListener("click", () => onCrowToggle()),
	}));
	const ports = { ui: { CrowSwitch } } as unknown as MapHostPorts;
	const { container } = render(MapTopControls, { ports, crowMode: "online", onCrowToggle });
	const pin = document.createElement("button");
	pin.className = "maplibregl-marker";
	pin.addEventListener("click", pinTapped);
	document.body.append(pin);
	return { pin, crow: container.querySelector<HTMLElement>("[data-crow]")!, eye: container.querySelector<HTMLElement>(".eye-toggle")! };
}

const under = (...els: Element[]) => {
	document.elementsFromPoint = () => els;
};

afterEach(() => {
	vi.clearAllMocks();
	document.body.replaceChildren();
});

describe("a pin under a top control takes the tap", () => {
	it("the crow yields to the pin beneath it, and switches maps when nothing is", async () => {
		const { pin, crow } = mount();
		under(crow, pin);
		await fireEvent.click(crow);
		expect(pinTapped).toHaveBeenCalledTimes(1);
		expect(onCrowToggle).not.toHaveBeenCalled();

		under(crow);
		await fireEvent.click(crow);
		expect(onCrowToggle).toHaveBeenCalledTimes(1);
		expect(pinTapped).toHaveBeenCalledTimes(1);
	});

	it("the eye yields the same way", async () => {
		const { pin, eye } = mount();
		under(eye, pin);
		await fireEvent.click(eye);
		expect(pinTapped).toHaveBeenCalledTimes(1);
		expect(eye.getAttribute("aria-pressed")).toBe("false");

		under(eye);
		await fireEvent.click(eye);
		expect(eye.getAttribute("aria-pressed")).toBe("true");
	});
});
