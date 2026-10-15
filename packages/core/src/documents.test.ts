import { describe, expect, it } from 'vitest';
import { sniffMimeType } from './documents.js';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('sniffMimeType', () => {
  it('BR-P04 tells a PDF, a PNG and a JPEG by their first bytes', () => {
    expect(sniffMimeType(text('%PDF-1.7\n'))).toBe('application/pdf');
    expect(
      sniffMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe('image/png');
    expect(sniffMimeType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it('BR-P04 AT-29 refuses anything else, whatever it is called: a program, text, a GIF, a cut-off signature, nothing', () => {
    for (const file of [
      text('MZ\x90\x00'), // a Windows .exe
      text('hello'),
      text('GIF89a'),
      text('%PD'),
      bytes(0x89, 0x50, 0x4e, 0x47),
      bytes(),
    ]) {
      expect(sniffMimeType(file)).toBeNull();
    }
  });
});
