/**
 * Kullanıcının yazdığı tutarı (ör. "1.250,50 ₺", "$1,250.50", "1250.5") tamsayı minor
 * birime (kuruş/cent) çevirir. Kayan nokta kullanılmaz; sonuç string aritmetiğiyle kurulur.
 *
 * Kurallar:
 * - Boşluk ve ₺, TL, TRY, $, €, USD, EUR temizlenir; negatif, boş ya da harf içeren → null.
 * - '.' ve ',' ikisi de varsa SON görünen ondalık, diğerleri binlik ayırıcıdır.
 * - Tek tür ayırıcı birden çok kez → binlik.
 * - Tek tür ayırıcı bir kez, ardından tam 3 hane ve fractionDigits < 3 → binlik.
 * - Aksi halde ondalık; fractionDigits'ten fazla ondalık hane → null.
 * - Binlik grupları: ilk grup 1-3 hane, sonrakiler tam 3 hane.
 */
export function parseAmountToMinor(input: string, fractionDigits = 2): number | null {
  const cleaned = input.replace(/\s+/g, "").replace(/₺|\$|€|TRY|TL|USD|EUR/gi, "");
  if (cleaned === "" || !/^[\d.,]+$/.test(cleaned)) return null;

  const separators = cleaned.replace(/\d/g, "");
  let intPart: string;
  let fracPart = "";

  if (separators === "") {
    intPart = cleaned;
  } else {
    const hasDot = separators.includes(".");
    const hasComma = separators.includes(",");
    if (hasDot && hasComma) {
      const decimalIndex = Math.max(cleaned.lastIndexOf("."), cleaned.lastIndexOf(","));
      const decimalChar = cleaned[decimalIndex];
      const thousandChar = decimalChar === "." ? "," : ".";
      const head = cleaned.slice(0, decimalIndex);
      if (head.includes(decimalChar)) return null;
      const grouped = parseGroups(head, thousandChar);
      if (grouped === null) return null;
      intPart = grouped;
      fracPart = cleaned.slice(decimalIndex + 1);
      if (fracPart === "") return null;
    } else {
      const sep = hasDot ? "." : ",";
      const parts = cleaned.split(sep);
      const isThousands = parts.length > 2 || (parts[1].length === 3 && fractionDigits < 3);
      if (isThousands) {
        const grouped = parseGroups(cleaned, sep);
        if (grouped === null) return null;
        intPart = grouped;
      } else {
        intPart = parts[0];
        fracPart = parts[1];
        if (intPart === "" || fracPart === "") return null;
      }
    }
  }

  if (fracPart.length > fractionDigits) return null;
  const digits = (intPart + fracPart.padEnd(fractionDigits, "0")).replace(/^0+(?=\d)/, "");
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** "1.250.000" → "1250000"; grup yapısı geçersizse null. */
function parseGroups(value: string, sep: string): string | null {
  const groups = value.split(sep);
  const [first, ...rest] = groups;
  if (!/^\d{1,3}$/.test(first)) return null;
  if (!rest.every((g) => /^\d{3}$/.test(g))) return null;
  return groups.join("");
}
