import { describe, expect, it } from 'vitest';
import en from './messages/en.json';
import zhCN from './messages/zh-CN.json';

describe('i18n message catalogs', () => {
  it('keep English and Simplified Chinese keys aligned', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses named interpolation tokens consistently', () => {
    for (const key of Object.keys(en)) {
      const tokens = (value: string) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)]
        .map((match) => match[1])
        .sort();
      expect(tokens(zhCN[key as keyof typeof zhCN])).toEqual(tokens(en[key as keyof typeof en]));
    }
  });
});
