/** Client-side voter JWT checks (payload only — not cryptographic verification). */

export type VoterTokenPayload = {
  voter_id?: string;
  constituency?: string;
  state?: string;
  exp?: number;
};

export function parseVoterTokenPayload(token: string): VoterTokenPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "="));
    return JSON.parse(json) as VoterTokenPayload;
  } catch {
    return null;
  }
}

/** Returns false if token is missing, malformed, expired, or not a voter portal JWT. */
export function isStoredVoterTokenUsable(token: string | null): boolean {
  if (!token) return false;
  const payload = parseVoterTokenPayload(token);
  if (!payload?.voter_id || !payload.constituency || !payload.state) {
    return false;
  }
  if (payload.exp && payload.exp * 1000 <= Date.now()) {
    return false;
  }
  return true;
}
