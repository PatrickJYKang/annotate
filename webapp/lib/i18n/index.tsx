'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import en from './messages/en.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import zhCN from './messages/zh-CN.json';

export const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'zh-CN'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type TranslationParams = Readonly<Record<string, string | number>>;
export type Translate = (key: string, params?: TranslationParams) => string;

const LOCALE_STORAGE_KEY = 'annotate:locale';
const messages: Record<Locale, Record<string, string>> = {
  en,
  fr,
  es,
  'zh-CN': zhCN,
};
const reportedMissingKeys = new Set<string>();

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

function isLocale(value: string | null): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

function interpolate(message: string, params?: TranslationParams): string {
  if (!params) return message;
  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (token, key: string) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : token
  ));
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('en');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
      if (isLocale(stored)) updateLocale(stored);
    } catch {
      // A blocked storage area should not prevent the app from using English.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    updateLocale(nextLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Locale still applies for this session when persistence is unavailable.
    }
  }, []);

  const t = useCallback<Translate>((key, params) => {
    const message = messages[locale][key] ?? messages.en[key];
    if (message === undefined) {
      if (process.env.NODE_ENV !== 'production') {
        const diagnosticKey = `${locale}:${key}`;
        if (!reportedMissingKeys.has(diagnosticKey)) {
          reportedMissingKeys.add(diagnosticKey);
          console.warn(`[i18n] Missing translation: ${diagnosticKey}`);
        }
      }
      return key;
    }
    return interpolate(message, params);
  }, [locale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    t,
    formatNumber: (number, options) => new Intl.NumberFormat(locale, options).format(number),
    formatDate: (date, options) => {
      const parsed = new Date(date);
      return Number.isNaN(parsed.getTime())
        ? String(date)
        : new Intl.DateTimeFormat(locale, options).format(parsed);
    },
  }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('useLocale must be used inside LocaleProvider.');
  return context;
}

export function useT(): Translate {
  return useLocale().t;
}

export { LOCALE_STORAGE_KEY };
