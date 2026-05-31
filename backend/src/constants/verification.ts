import { config } from "../utils/config.js";

/** Default liveness threshold for request-time selfie checks (matches election_settings default). */
export const DEFAULT_LIVENESS_THRESHOLD = config.isProd ? 0.4 : 0.2;

export const MAX_SELFIE_B64_LENGTH = 15 * 1024 * 1024;
