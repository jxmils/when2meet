import { describe, expect, it } from 'vitest';
import { eventUrl, isWhen2meetHost, parseEventRef } from '../src/url.ts';

describe('parseEventRef', () => {
  it.each([
    ['https://www.when2meet.com/?11591331-ySlfG', { id: 11591331, code: 'ySlfG' }],
    ['https://when2meet.com/?11591331-ySlfG', { id: 11591331, code: 'ySlfG' }],
    ['http://www.when2meet.com/?11591331-ySlfG#x', { id: 11591331, code: 'ySlfG' }],
    ['www.when2meet.com/?24892637-Evxyx', { id: 24892637, code: 'Evxyx' }],
    ['?24892637-Evxyx', { id: 24892637, code: 'Evxyx' }],
    ['24892637-Evxyx', { id: 24892637, code: 'Evxyx' }],
    ['  ?24892637-Evxyx&utm=1 ', { id: 24892637, code: 'Evxyx' }],
  ])('reads %s', (input, expected) => {
    expect(parseEventRef(input)).toEqual(expected);
  });

  it.each([
    'https://www.when2meet.com/',
    'https://www.when2meet.com/?About',
    'https://example.com/?123-abc',
    'not a url',
    '?0-abc',
    '?123-',
  ])('rejects %s', (input) => {
    expect(parseEventRef(input)).toBeNull();
  });

  it('accepts other hosts when asked (web-app links mirror When2meet)', () => {
    expect(parseEventRef('https://fill.example.org/?123-abc', { anyHost: true })).toEqual({
      id: 123,
      code: 'abc',
    });
  });
});

describe('helpers', () => {
  it('builds poll URLs and recognises hosts', () => {
    expect(eventUrl({ id: 1, code: 'x' })).toBe('https://www.when2meet.com/?1-x');
    expect(isWhen2meetHost('WWW.When2meet.com')).toBe(true);
    expect(isWhen2meetHost('when2meet.com.evil.test')).toBe(false);
  });
});
