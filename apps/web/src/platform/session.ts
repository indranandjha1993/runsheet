// The key the person pasted at sign-in. It lives in the browser only, and every request adds it.
const KEY = "runsheet.key";
const LOCALE = "runsheet.locale";

export interface Session {
  readonly key: string;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function currentSession(): Session | undefined {
  const key = storage()?.getItem(KEY);
  return key === null || key === undefined || key.trim() === "" ? undefined : { key };
}

export function signIn(key: string): Session {
  const trimmed = key.trim();
  if (!/^rsk_[0-9a-f]{16,}$/.test(trimmed)) {
    throw new Error("that does not look like a Runsheet key");
  }
  storage()?.setItem(KEY, trimmed);
  return { key: trimmed };
}

export function signOut(): void {
  storage()?.removeItem(KEY);
}

export function savedLocale(): string | undefined {
  return storage()?.getItem(LOCALE) ?? undefined;
}

export function saveLocale(code: string): void {
  storage()?.setItem(LOCALE, code);
}
