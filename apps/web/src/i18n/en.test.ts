import { describe, expect, it } from 'vitest';
import { en } from './en';

describe('the strings of the interface', () => {
  it('has no string that nothing uses any more', () => {
    // The badge of an entry made by the LLM is drawn by `originLlm`; this one was never shown.
    expect('badgeLlm' in en.llm).toBe(false);
  });
});
