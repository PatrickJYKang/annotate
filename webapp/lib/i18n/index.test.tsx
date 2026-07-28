import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import es from './messages/es.json';
import fr from './messages/fr.json';
import zhCN from './messages/zh-CN.json';

const catalogs = { fr, es, 'zh-CN': zhCN };

describe('i18n message catalogs', () => {
  it('keeps every translated catalog aligned with English', () => {
    for (const catalog of Object.values(catalogs)) {
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
    }
  });

  it('uses named interpolation tokens consistently', () => {
    const tokens = (value: string) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
      .map((match) => match[1])
      .sort();

    for (const catalog of Object.values(catalogs)) {
      for (const key of Object.keys(en)) {
        expect(tokens(catalog[key as keyof typeof catalog])).toEqual(tokens(en[key as keyof typeof en]));
      }
    }
  });
});
