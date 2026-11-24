import { describe, expect, it } from 'vitest';
import { NUMBER_WORDS, amountInWordsIn, numberInWords } from './langs';

describe('amount in words: Hindi, Gujarati, Punjabi', () => {
  it('has one word for every number 1–99', () => {
    for (const [lang, list] of Object.entries(NUMBER_WORDS)) {
      expect(list.length, lang).toBe(100);
      expect(new Set(list.slice(1)).size, `${lang} duplicates`).toBe(99);
    }
  });
  it('builds Indian-system numbers', () => {
    expect(numberInWords(1_25_43_567, 'hi')).toBe('एक करोड़ पच्चीस लाख तैंतालीस हज़ार पाँच सौ सड़सठ');
    expect(numberInWords(1_000, 'gu')).toBe('એક હજાર');
    expect(numberInWords(250, 'pa')).toBe('ਦੋ ਸੌ ਪੰਜਾਹ');
  });
  it('writes rupees and paise', () => {
    expect(amountInWordsIn(1062000, 'hi')).toBe('रुपये दस हज़ार छह सौ बीस मात्र');
    expect(amountInWordsIn(10050, 'gu')).toBe('રૂપિયા એક સો અને પચાસ પૈસા પૂરા');
    expect(amountInWordsIn(190000, 'en')).toBe('Rupees One Thousand Nine Hundred Only');
  });
});
