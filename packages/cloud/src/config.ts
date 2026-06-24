export const PRODUCTION_CLERK_BASE_URL = "https://clerk.brocode.com"
export const PRODUCTION_BRO_CODE_API_URL = "https://app.brocode.com"

export const getClerkBaseUrl = () => process.env.CLERK_BASE_URL || PRODUCTION_CLERK_BASE_URL

export const getBroCodeApiUrl = () => process.env.BRO_CODE_API_URL || PRODUCTION_BRO_CODE_API_URL
