import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8')) as { minYouTrackVersion: string };

describe('manifest', () => {
  it('requires YouTrack 2026.2', () => {
    expect(manifest.minYouTrackVersion).toBe('2026.2.0');
  });
});
