import { describe, expect, it, vi } from "vitest";
import { parseAppConfig } from "@/lib/config/app-config";
import {
  extractHosts,
  normalizeForScan,
  scanMessage,
  scanMessageRules,
  type MessageRiskReason,
} from "@/lib/trust/message-scan";

const cfg = parseAppConfig({});
const blockCfg = parseAppConfig({ MESSAGE_SCAN_BLOCK_HIGH_RISK: "true" });

type Row = [string, "NONE" | "WARN" | "HIGH", MessageRiskReason[]];

// P1-6: TR/EN örnekleri — beklenen seviye ve (en az) gerekçe kodları.
const TABLE: Row[] = [
  ["Merhaba, giriş saati 14:00'ten itibaren. İyi yolculuklar!", "NONE", []],
  ["Hi! Check-in is after 3 pm, the key is in the lockbox.", "NONE", []],
  ["Otopark var mı? Saat 18.30 gibi varırız.", "NONE", []],
  [
    "Kaporayı IBAN'a havale edin: TR33 0006 1005 1978 6457 8413 26",
    "HIGH",
    ["IBAN", "BANK_TRANSFER_REQUEST", "OFF_PLATFORM_PAYMENT_REQUEST"],
  ],
  [
    "Please send a wire transfer to DE89 3704 0044 0532 0130 00",
    "HIGH",
    ["IBAN", "BANK_TRANSFER_REQUEST"],
  ],
  [
    "Komisyon ödemeyin, WhatsApp'tan yazın, daha ucuza veririm",
    "HIGH",
    ["OFF_PLATFORM_PAYMENT_REQUEST", "OFF_PLATFORM_CONTACT"],
  ],
  ["whatsapp'tan yaz lütfen", "WARN", ["OFF_PLATFORM_CONTACT"]],
  ["Text me on WhatsApp for a better price", "WARN", ["OFF_PLATFORM_CONTACT"]],
  ["Pay me directly to avoid the fees", "WARN", ["OFF_PLATFORM_PAYMENT_REQUEST"]],
  ["Ödemeyi bu linkten yapın: https://bit.ly/3xYzAb", "WARN", ["SHORTENED_LINK"]],
  ["Please pay here: paypal.me/hostjohn", "HIGH", ["PAYMENT_LINK"]],
  [
    "Rezervasyonu iptal et, buradan öde: https://iyzi.link/AbC123 hemen öde",
    "HIGH",
    ["PAYMENT_LINK", "URGENCY_PRESSURE"],
  ],
  ["Bana wa.me/905551112233 adresinden ulaşın", "WARN", ["MESSENGER_LINK"]],
  [
    "We accept USDT only, pay directly to my wallet address",
    "HIGH",
    ["CRYPTO_PAYMENT", "OFF_PLATFORM_PAYMENT_REQUEST"],
  ],
  ["Menüye www.ornek-restoran.com adresinden bakabilirsiniz", "NONE", ["EXTERNAL_LINK"]],
  ["EFT ile öder misiniz, hesap numaramı atayım", "WARN", ["BANK_TRANSFER_REQUEST"]],
  ["Send bitcoin to this wallet address", "WARN", ["CRYPTO_PAYMENT"]],
];

describe("P1-6 mesaj dolandırıcılık taraması (tablo)", () => {
  it.each(TABLE)("%s → %s", (text, level, reasons) => {
    const r = scanMessageRules(text, { config: cfg });
    expect(r.level).toBe(level);
    for (const reason of reasons) expect(r.reasons).toContain(reason);
    if (reasons.length === 0) expect(r.reasons).toEqual([]);
    expect(r.blocked).toBe(false);
    expect(r.llmSignal).toBeNull();
  });

  it("gerekçeler ağırlığa göre sıralı, skor 100 ile sınırlı", () => {
    const r = scanMessageRules(
      "IBAN TR33 0006 1005 1978 6457 8413 26, paypal.me/x, bit.ly/y, komisyonsuz, usdt",
      { config: cfg }
    );
    expect(r.score).toBe(100);
    expect(r.reasons[0]).toBe("IBAN");
    expect(r.reasons.indexOf("PAYMENT_LINK")).toBeLessThan(r.reasons.indexOf("SHORTENED_LINK"));
  });

  it("engelleme yalnızca config açıkken ve yüksek riskte", () => {
    expect(scanMessageRules("paypal.me/x", { config: blockCfg }).blocked).toBe(true);
    expect(scanMessageRules("whatsapp'tan yaz", { config: blockCfg }).blocked).toBe(false);
  });

  it("tarama kapalıysa hiçbir şey işaretlenmez", () => {
    const off = parseAppConfig({ MESSAGE_SCAN_ENABLED: "false" });
    expect(
      scanMessageRules("paypal.me/x IBAN TR33 0006 1005 1978 6457 8413 26", { config: off })
    ).toMatchObject({
      level: "NONE",
      reasons: [],
    });
  });

  it("platformun kendi alan adı link sayılmaz; alan adı listesi config'ten", () => {
    expect(
      scanMessageRules("Rezervasyon: https://booking.example.com/b/1", {
        config: cfg,
        ownHosts: ["booking.example.com"],
      }).reasons
    ).toEqual([]);
    const custom = parseAppConfig({ MESSAGE_SCAN_PAYMENT_DOMAINS: "evil-pay.io" });
    expect(scanMessageRules("pay at evil-pay.io/abc", { config: custom }).reasons).toContain(
      "PAYMENT_LINK"
    );
    expect(scanMessageRules("pay at paypal.me/abc", { config: custom }).reasons).not.toContain(
      "PAYMENT_LINK"
    );
  });

  it("e-posta alan adı link sayılmaz; şemasız belirsiz nokta link değildir", () => {
    expect(extractHosts("mail: a@gmail.com")).toEqual([]);
    expect(scanMessageRules("evet.tamam görüşürüz", { config: cfg }).reasons).toEqual([]);
  });

  it("normalleştirme: Türkçe karakterler ve kesme işareti", () => {
    expect(normalizeForScan("WhatsApp'TAN ÖDEMEYİ Şimdi")).toBe("whatsapptan odemeyi simdi");
  });
});

describe("LLM yalnızca ek sinyal — kapalıyken aynı kurallar", () => {
  it.each(TABLE)("%s: LLM SUSPICIOUS/BENIGN kararı değiştirmez", async (text) => {
    const base = scanMessageRules(text, { config: blockCfg });
    const noLlm = await scanMessage(text, { config: blockCfg });
    const suspicious = await scanMessage(text, {
      config: blockCfg,
      classify: async () => "SUSPICIOUS",
    });
    const benign = await scanMessage(text, { config: blockCfg, classify: async () => "BENIGN" });
    for (const r of [noLlm, suspicious, benign]) {
      expect({ ...r, llmSignal: null }).toEqual(base);
    }
    expect(suspicious.llmSignal).toBe("SUSPICIOUS");
    expect(benign.llmSignal).toBe("BENIGN");
  });

  it("sınıflandırıcı hata verirse sinyal yok, karar aynı", async () => {
    const classify = vi.fn().mockRejectedValue(new Error("timeout"));
    const r = await scanMessage("paypal.me/x", { config: cfg, classify });
    expect(r.llmSignal).toBeNull();
    expect(r.level).toBe("HIGH");
  });
});
