import * as os from "os"

export interface LanAddressCandidate {
	/** Interface name as reported by `os.networkInterfaces()` (e.g. "Wi-Fi", "eth0"). */
	name: string
	address: string
	/** Lower is preferred. Used only for sorting; not exposed outside this module. */
	rank: number
}

/**
 * Private-LAN address prefixes, ranked best-first. Addresses matching an earlier
 * prefix are preferred over addresses matching a later one (or no prefix at all),
 * so a genuine home/office LAN adapter is chosen over VPN/WSL/Docker adapters that
 * also hand out RFC1918-shaped addresses.
 */
const PREFERRED_PREFIXES = [/^192\.168\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./]

/**
 * Interface name substrings that usually indicate a virtual adapter (VPN, WSL,
 * Docker, Hyper-V, container bridges) rather than the physical LAN connection.
 * Matched case-insensitively against the interface name reported by Node.
 */
const DEPRIORITIZED_NAME_HINTS = [
	"vethernet",
	"wsl",
	"docker",
	"vmware",
	"virtualbox",
	"vboxnet",
	"tailscale",
	"zerotier",
	"tap",
	"tun",
	"vpn",
	"loopback",
	"npcap",
]

function rankAddress(name: string, address: string): number {
	const lowerName = name.toLowerCase()
	const isDeprioritizedName = DEPRIORITIZED_NAME_HINTS.some((hint) => lowerName.includes(hint))

	const prefixRank = PREFERRED_PREFIXES.findIndex((prefix) => prefix.test(address))
	// prefixRank of -1 (no private-LAN prefix match) sorts after every explicit prefix rank.
	const baseRank = prefixRank === -1 ? PREFERRED_PREFIXES.length : prefixRank

	// Deprioritized adapter names are pushed behind all non-deprioritized candidates,
	// regardless of address shape, but are still returned (better than nothing).
	return isDeprioritizedName ? baseRank + PREFERRED_PREFIXES.length + 1 : baseRank
}

/**
 * Enumerates all non-internal IPv4 addresses across every network interface,
 * ranked so the most likely "real" home/office LAN address sorts first.
 * Exported (in addition to `getLanAddress`) so callers that need to log every
 * candidate for diagnosis (ambiguous multi-interface machines) can do so.
 */
export function listLanAddressCandidates(
	interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LanAddressCandidate[] {
	const candidates: LanAddressCandidate[] = []

	for (const [name, infos] of Object.entries(interfaces)) {
		if (!infos) {
			continue
		}

		for (const info of infos) {
			if (info.internal || info.family !== "IPv4") {
				continue
			}

			candidates.push({ name, address: info.address, rank: rankAddress(name, info.address) })
		}
	}

	return candidates.sort((a, b) => a.rank - b.rank)
}

/**
 * Picks the best candidate LAN address to bind the mobile server to, preferring
 * private-LAN prefixes (192.168./10./172.16-31.) over VPN/WSL/Docker adapters that
 * also report RFC1918-shaped addresses (decision 3 in the mobile-server plan).
 * Returns `undefined` if the machine has no non-internal IPv4 interface at all
 * (e.g. fully offline, loopback-only).
 */
export function getLanAddress(
	interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): LanAddressCandidate | undefined {
	return listLanAddressCandidates(interfaces)[0]
}
