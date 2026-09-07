// A link can carry the key, the language, and a run to open, in the fragment. The fragment
// never leaves the browser, so it is not in any server's log, and it is cleared the moment it is
// read so it is not in the address bar either. It is how the sandbox opens the console signed in
// and how a dispatcher hands a driver their run.
export interface LinkHints {
  readonly key?: string;
  readonly locale?: string;
  readonly run?: string;
}

export function readLink(hash: string): LinkHints {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const key = params.get("key") ?? undefined;
  const locale = params.get("locale") ?? undefined;
  const run = params.get("run") ?? undefined;
  return {
    ...(key === undefined ? {} : { key }),
    ...(locale === undefined ? {} : { locale }),
    ...(run === undefined ? {} : { run }),
  };
}

export function consumeLink(): LinkHints {
  const hints = readLink(window.location.hash);
  if (window.location.hash !== "") {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return hints;
}
