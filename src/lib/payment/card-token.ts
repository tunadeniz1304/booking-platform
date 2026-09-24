/**
 * Mock "hosted field" tokenizer — TARAYICIDA çalışır, sunucuya yalnızca token gider.
 *
 * Deterministik test kartları (Stripe test kartlarıyla uyumlu):
 *   4000 0000 0000 0002 → ret (card_declined)
 *   4000 0000 0000 3220 (…3220) → 3DS doğrulaması gerekir
 *   Diğer Luhn-geçerli kartlar → onay
 *
 * Token biçimi: `tok_mock_<senaryo>_<son4>`; kart numarası token'dan geri elde edilemez.
 */

export type MockCardScenario = "ok" | "decline" | "3ds";

export const MOCK_3DS_CODE = "123456";

export const TEST_CARDS = {
  success: "4242 4242 4242 4242",
  decline: "4000 0000 0000 0002",
  threeDs: "4000 0000 0000 3220",
} as const;

const MOCK_CARD_PATTERN = /^tok_mock_(ok|decline|3ds)_(\d{4})$/;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardValidationError";
  }
}

/** Kartı doğrular ve token üretir (istemci tarafı). */
export function tokenizeCard(
  input: { number: string; expMonth: number; expYear: number; cvc: string },
  now = new Date()
): string {
  const digits = input.number.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits) || !luhn(digits)) {
    throw new CardValidationError("Kart numarası geçersiz");
  }
  if (!/^\d{3,4}$/.test(input.cvc)) throw new CardValidationError("CVC geçersiz");
  const expEnd = Date.UTC(input.expYear, input.expMonth, 1);
  if (!(input.expMonth >= 1 && input.expMonth <= 12) || expEnd <= now.getTime()) {
    throw new CardValidationError("Kartın son kullanma tarihi geçmiş");
  }
  const scenario: MockCardScenario =
    digits === "4000000000000002" ? "decline" : digits.endsWith("3220") ? "3ds" : "ok";
  return `tok_mock_${scenario}_${digits.slice(-4)}`;
}

export function parseMockToken(
  token: string
): { scenario: MockCardScenario; last4: string } | null {
  const m = MOCK_CARD_PATTERN.exec(token);
  return m ? { scenario: m[1] as MockCardScenario, last4: m[2] } : null;
}
