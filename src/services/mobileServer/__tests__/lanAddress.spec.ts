import { describe, it, expect } from "vitest"
import * as os from "os"

import { getLanAddress, listLanAddressCandidates } from "../lanAddress"

function interfaces(
	entries: Record<string, Partial<os.NetworkInterfaceInfo>[]>,
): NodeJS.Dict<os.NetworkInterfaceInfo[]> {
	const result: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {}

	for (const [name, infos] of Object.entries(entries)) {
		result[name] = infos.map((info) => ({
			address: "0.0.0.0",
			netmask: "255.255.255.0",
			family: "IPv4",
			mac: "00:00:00:00:00:00",
			internal: false,
			cidr: null,
			...info,
		})) as os.NetworkInterfaceInfo[]
	}

	return result
}

describe("getLanAddress", () => {
	it("picks the home-LAN address when it's the only non-internal interface", () => {
		const result = getLanAddress(
			interfaces({
				lo: [{ address: "127.0.0.1", internal: true }],
				"Wi-Fi": [{ address: "192.168.1.42" }],
			}),
		)

		expect(result?.address).toBe("192.168.1.42")
		expect(result?.name).toBe("Wi-Fi")
	})

	it("prefers the real LAN adapter over a VPN/WSL adapter that also reports an RFC1918 address", () => {
		const result = getLanAddress(
			interfaces({
				lo: [{ address: "127.0.0.1", internal: true }],
				"vEthernet (WSL)": [{ address: "172.20.0.1" }],
				Tailscale: [{ address: "100.64.0.5" }],
				"Wi-Fi": [{ address: "192.168.1.42" }],
			}),
		)

		expect(result?.address).toBe("192.168.1.42")
		expect(result?.name).toBe("Wi-Fi")
	})

	it("returns undefined when only loopback is present", () => {
		const result = getLanAddress(
			interfaces({
				lo: [{ address: "127.0.0.1", internal: true }],
			}),
		)

		expect(result).toBeUndefined()
	})

	it("still returns a candidate when only VPN/WSL-shaped adapters exist (better than nothing)", () => {
		const result = getLanAddress(
			interfaces({
				lo: [{ address: "127.0.0.1", internal: true }],
				"vEthernet (WSL)": [{ address: "172.20.0.1" }],
			}),
		)

		expect(result?.address).toBe("172.20.0.1")
	})

	it("prefers 192.168.x over 10.x, and 10.x over 172.16-31.x, all else equal", () => {
		const candidates = listLanAddressCandidates(
			interfaces({
				eth0: [{ address: "172.16.0.5" }],
				eth1: [{ address: "10.0.0.5" }],
				eth2: [{ address: "192.168.0.5" }],
			}),
		)

		expect(candidates.map((c) => c.address)).toEqual(["192.168.0.5", "10.0.0.5", "172.16.0.5"])
	})

	it("ignores IPv6 addresses", () => {
		const result = getLanAddress(
			interfaces({
				"Wi-Fi": [
					{ address: "fe80::1", family: "IPv6" },
					{ address: "192.168.1.10", family: "IPv4" },
				],
			}),
		)

		expect(result?.address).toBe("192.168.1.10")
	})
})
