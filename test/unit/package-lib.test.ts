import { describe, expect, it } from 'vitest';
import { checkPackage, type ZipEntry } from '../../scripts/package-lib.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const statics: ZipEntry[] = [
  { name: 'manifest.json', content: text('{}') },
  { name: 'settings.json', content: text('{}') },
  { name: 'icon.svg', content: text('<svg/>') },
];

describe('checkPackage', () => {
  it('accepts the static files plus one module per backend file', () => {
    const entries = [
      ...statics,
      { name: 'api.js', content: text('exports.httpHandler = httpHandler;') },
      { name: 'get-custom-fields.js', content: text('exports.aiTool = aiTool;') },
    ];
    expect(checkPackage(entries, ['api', 'get-custom-fields'])).toEqual([]);
  });

  it('reports missing static and backend files', () => {
    expect(checkPackage(statics.slice(1), ['api'])).toEqual([
      'missing manifest.json at the zip root',
      'missing api.js at the zip root',
    ]);
  });

  it('reports files that are not at the zip root', () => {
    const entries = [...statics, { name: 'widgets/x.js', content: text('exports.aiTool = aiTool;') }];
    expect(checkPackage(entries, [])).toEqual(['widgets/x.js is not at the zip root']);
  });

  it('requires every script to export exactly one of httpHandler or aiTool', () => {
    const entries = [
      ...statics,
      { name: 'a.js', content: text('module.exports = {};') },
      { name: 'b.js', content: text('exports.httpHandler = h;\nexports.aiTool = t;') },
    ];
    expect(checkPackage(entries, ['a', 'b'])).toEqual([
      'a.js must export exactly one of httpHandler or aiTool (found 0)',
      'b.js must export exactly one of httpHandler or aiTool (found 2)',
    ]);
  });
});
