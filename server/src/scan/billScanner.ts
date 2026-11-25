import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Reads a photo of a supplier's bill into a purchase draft. The phone shows the result for the
 * person to check and correct before saving; nothing is saved from here.
 *
 * Provider adapter: today Claude through the Anthropic SDK. Another provider can be added behind
 * the same `BillScanner` interface.
 */

export const scannedBill = z.object({
  supplierName: z.string(),
  supplierGstin: z.string(),
  billNo: z.string(),
  /** YYYY-MM-DD, or "" when not readable. */
  date: z.string(),
  /** Bill shows GST (CGST/SGST/IGST) on items. */
  hasGst: z.boolean(),
  /** IGST charged (supplier in another state). */
  igst: z.boolean(),
  lines: z.array(
    z.object({
      name: z.string(),
      hsn: z.string(),
      qty: z.number(),
      unit: z.string(),
      /** Price per unit before tax, in rupees. */
      rate: z.number(),
      taxPct: z.number(),
      /** MRP per unit in rupees, 0 when not printed. */
      mrp: z.number(),
    }),
  ),
  /** Bill total in rupees as printed. */
  total: z.number(),
});
export type ScannedBill = z.infer<typeof scannedBill>;

export type ScanKind = 'purchase' | 'sale';

export interface BillScanner {
  readonly name: string;
  scan(image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }, kind?: ScanKind): Promise<ScannedBill>;
}

export class ScanError extends Error {}

const TOOL_NAME = 'record_bill';

const SALE_INTRO = `This is a photo of a sales bill an Indian shop wrote or printed for its customer (often a page of a paper bill book).
Read it and call the ${TOOL_NAME} tool once with what is on it. Put the customer's name in supplierName and their GSTIN (if any) in supplierGstin.`;

const PROMPT = `This is a photo of a supplier's purchase bill (tax invoice or cash memo) from an Indian shop.
Read it and call the ${TOOL_NAME} tool once with what is printed on it.
- Amounts in rupees as numbers (no commas or ₹). "rate" is the price per unit before GST; if the bill only shows a tax-inclusive price, work out the price before tax.
- "taxPct" is the full GST rate of the line (CGST 9% + SGST 9% = 18). Use 0 for no GST.
- Use "" for text and 0 for numbers you can't read. Don't guess item names: copy them as printed.
- Leave out totals, discounts and tax rows from "lines"; only goods or services bought.
- Dates as YYYY-MM-DD.`;

/** JSON Schema of the tool's input (strict: the API keeps the output to exactly this shape). */
const INPUT_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['supplierName', 'supplierGstin', 'billNo', 'date', 'hasGst', 'igst', 'lines', 'total'],
  properties: {
    supplierName: { type: 'string' },
    supplierGstin: { type: 'string' },
    billNo: { type: 'string' },
    date: { type: 'string' },
    hasGst: { type: 'boolean' },
    igst: { type: 'boolean' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'hsn', 'qty', 'unit', 'rate', 'taxPct', 'mrp'],
        properties: {
          name: { type: 'string' },
          hsn: { type: 'string' },
          qty: { type: 'number' },
          unit: { type: 'string' },
          rate: { type: 'number' },
          taxPct: { type: 'number' },
          mrp: { type: 'number' },
        },
      },
    },
    total: { type: 'number' },
  },
};

export class ClaudeBillScanner implements BillScanner {
  readonly name = 'claude';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 });
  }

  async scan(image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }, kind: ScanKind = 'purchase'): Promise<ScannedBill> {
    const prompt = kind === 'sale' ? `${SALE_INTRO}\n${PROMPT.split('\n').slice(2).join('\n')}` : PROMPT;
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 16000,
      // If the model declines, the API retries on a fallback model in the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      tools: [{ name: TOOL_NAME, description: 'Record the bill as read from the photo.', strict: true, input_schema: INPUT_SCHEMA }],
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal') throw new ScanError('The bill could not be read. Please enter it by hand.');
    const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (!call) throw new ScanError('No bill found in the photo. Try a clearer photo of the whole bill.');
    const parsed = scannedBill.safeParse(call.input);
    if (!parsed.success) throw new ScanError('The bill could not be read. Please enter it by hand.');
    return parsed.data;
  }
}

/** The configured scanner, or null when no AI key is set (the app then hides "Scan bill"). */
export function billScannerFromEnv(env: { ANTHROPIC_API_KEY?: string; SCAN_MODEL: string }): BillScanner | null {
  return env.ANTHROPIC_API_KEY ? new ClaudeBillScanner(env.ANTHROPIC_API_KEY, env.SCAN_MODEL) : null;
}
