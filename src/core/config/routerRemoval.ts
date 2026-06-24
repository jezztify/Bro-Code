import { t } from "../../i18n"

export const LEGACY_BRO_PROVIDER = "bro"

const ROUTER_REMOVAL_I18N_KEY = "common:errors.bro.routerRemoved"
const ROUTER_REMOVAL_DEFAULT_MESSAGE =
	"Bro Code Router has been removed. Please select and configure a different provider."

const ROUTER_SIGN_IN_UNAVAILABLE_I18N_KEY = "common:info.bro.signInUnavailable"
const ROUTER_SIGN_IN_UNAVAILABLE_DEFAULT_MESSAGE =
	"Bro Code Cloud sign-in is currently unavailable. Configure another provider to continue."

function getLocalizedMessage(key: string, defaultValue: string) {
	const translated = t(key, { defaultValue })
	return translated === key ? defaultValue : translated
}

export const getRouterRemovalMessage = () =>
	getLocalizedMessage(ROUTER_REMOVAL_I18N_KEY, ROUTER_REMOVAL_DEFAULT_MESSAGE)

export const getRouterUnavailableSignInMessage = () =>
	getLocalizedMessage(ROUTER_SIGN_IN_UNAVAILABLE_I18N_KEY, ROUTER_SIGN_IN_UNAVAILABLE_DEFAULT_MESSAGE)

export const ROUTER_REMOVAL_IMPORT_WARNING =
	"Bro Code Router was removed. The imported profile was downgraded and needs to be reconfigured."

type LegacyBroConfig = Record<string, unknown> & {
	apiProvider: typeof LEGACY_BRO_PROVIDER
}

export function isLegacyBroConfig(value: unknown): value is LegacyBroConfig {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as Record<string, unknown>).apiProvider === LEGACY_BRO_PROVIDER
	)
}

export function downgradeLegacyBroConfig<T extends Record<string, unknown>>(
	config: T,
): { config: Omit<T, "apiProvider" | "apiModelId" | "broApiKey">; migrated: boolean } {
	if (!isLegacyBroConfig(config)) {
		return { config: config as Omit<T, "apiProvider" | "apiModelId" | "broApiKey">, migrated: false }
	}

	const { apiProvider: _apiProvider, apiModelId: _apiModelId, broApiKey: _broApiKey, ...rest } = config

	return {
		config: rest as Omit<T, "apiProvider" | "apiModelId" | "broApiKey">,
		migrated: true,
	}
}
