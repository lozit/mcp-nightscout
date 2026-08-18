import { Entry, findCredentials } from "@napi-rs/keyring";

/**
 * The Nightscout **readable** token, held in the OS keychain, keyed by site host.
 *
 * Only the long-lived token lives here. The **JWT is deliberately never persisted**
 * (ADR 0002): it is short-lived and re-obtainable from the token, so writing it to
 * disk would add a second copy of a credential for no benefit. It stays in memory.
 */
const SERVICE = "mcp-nightscout";

export function storeToken(host: string, token: string): void {
  new Entry(SERVICE, host).setPassword(token);
}

export function readToken(host: string): string | null {
  try {
    return new Entry(SERVICE, host).getPassword();
  } catch {
    // No entry for this host, or the keychain declined. Either way there is no
    // token to return — the caller decides what to say about it.
    return null;
  }
}

export function deleteToken(host: string): boolean {
  try {
    return new Entry(SERVICE, host).deletePassword();
  } catch {
    return false;
  }
}

/** Hosts with a stored token, for defaulting a prompt or listing choices. */
export function storedHosts(): string[] {
  try {
    return findCredentials(SERVICE).map((entry) => entry.account);
  } catch {
    return [];
  }
}
