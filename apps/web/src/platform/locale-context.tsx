import { createContext, useContext, useMemo, useState, type JSX, type ReactNode } from "react";
import { LOCALES, translator, type LocaleCode, type Translator } from "@runsheet/driver";
import { saveLocale, savedLocale } from "./session.js";

interface LocaleState {
  readonly code: LocaleCode;
  readonly t: Translator;
  readonly choose: (code: LocaleCode) => void;
}

const Context = createContext<LocaleState | undefined>(undefined);

function isLocale(code: string | undefined): code is LocaleCode {
  return LOCALES.some((locale) => locale.code === code);
}

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: string | undefined }): JSX.Element {
  const remembered = isLocale(initial) ? initial : savedLocale();
  const [code, setCode] = useState<LocaleCode>(isLocale(remembered) ? remembered : "en");

  const state = useMemo<LocaleState>(() => {
    const t = translator(code);
    // Direction and language are set on the document, so every element inherits them and the
    // browser lays the whole page out the right way round.
    document.documentElement.setAttribute("dir", t.direction);
    document.documentElement.setAttribute("lang", code);
    return {
      code,
      t,
      choose: (next) => {
        saveLocale(next);
        setCode(next);
      },
    };
  }, [code]);

  return <Context.Provider value={state}>{children}</Context.Provider>;
}

export function useLocale(): LocaleState {
  const state = useContext(Context);
  if (state === undefined) throw new Error("useLocale needs a LocaleProvider above it");
  return state;
}
