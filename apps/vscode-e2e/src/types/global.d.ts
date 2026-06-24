import type { BroCodeAPI } from "@bro-code/types"

declare global {
	// eslint-disable-next-line no-var -- var is required in declare global
	var api: BroCodeAPI
}

export {}
