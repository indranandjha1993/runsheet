import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";
import { createApi, type Api } from "./api.js";
import { currentSession, signIn, signOut, type Session } from "./session.js";

interface Access {
  readonly api: Api;
  readonly session: Session | undefined;
  readonly signIn: (key: string) => void;
  readonly signOut: () => void;
}

const Context = createContext<Access | undefined>(undefined);

function startingSession(initialKey: string | undefined): Session | undefined {
  if (initialKey === undefined) return currentSession();
  try {
    return signIn(initialKey);
  } catch {
    return currentSession();
  }
}

export function AccessProvider({
  children,
  fetcher,
  initialKey,
}: {
  children: ReactNode;
  fetcher?: typeof globalThis.fetch;
  initialKey?: string | undefined;
}): JSX.Element {
  const [session, setSession] = useState<Session | undefined>(() => startingSession(initialKey));

  const access = useMemo<Access>(
    () => ({
      api: createApi({ key: () => session?.key, ...(fetcher === undefined ? {} : { fetch: fetcher }) }),
      session,
      signIn: (key) => {
        setSession(signIn(key));
      },
      signOut: () => {
        signOut();
        setSession(undefined);
      },
    }),
    [session, fetcher],
  );

  return <Context.Provider value={access}>{children}</Context.Provider>;
}

export function useAccess(): Access {
  const access = useContext(Context);
  if (access === undefined) throw new Error("useAccess needs an AccessProvider above it");
  return access;
}
