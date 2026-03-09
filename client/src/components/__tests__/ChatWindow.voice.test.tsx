import { describe, it, expect } from 'vitest';

describe('Voice message URL handling', () => {
  const buildFullUrl = (url: string) =>
    url.startsWith('http') ? url : `${window.location.origin}${url.startsWith('/') ? '' : '/'}${url}`;

  it('keeps absolute URLs unchanged', () => {
    const abs = 'https://example.com/audio.webm';
    expect(buildFullUrl(abs)).toBe(abs);
  });

  it('converts relative URLs to absolute', () => {
    const rel = '/uploads/voice/abc.webm';
    expect(buildFullUrl(rel)).toBe(`${window.location.origin}/uploads/voice/abc.webm`);
  });

  it('handles empty string', () => {
    expect(buildFullUrl('')).toBe(`${window.location.origin}/`);
  });
});
