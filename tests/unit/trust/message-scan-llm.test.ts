import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "live" as "live" | "demo",
  result: { data: { label: "SUSPICIOUS" }, llmMode: "live" } as {
    data: { label: string };
    llmMode: string;
  },
  calls: 0,
}));

vi.mock("@/lib/llm/client", () => ({
  getLlmClient: () => ({
    settings: { effectiveMode: state.mode },
    completeJson: async () => {
      state.calls++;
      return state.result;
    },
  }),
}));

import { resetConfigForTests } from "@/lib/config/app-config";
import { getMessageRiskClassifier } from "@/lib/trust/message-scan-llm";
import { scanMessage } from "@/lib/trust/message-scan";

describe("P1-6 opsiyonel LLM mesaj sınıflandırıcısı", () => {
  afterEach(() => {
    delete process.env.MESSAGE_SCAN_LLM_ENABLED;
    resetConfigForTests();
    state.mode = "live";
    state.calls = 0;
  });

  const enable = () => {
    process.env.MESSAGE_SCAN_LLM_ENABLED = "true";
    resetConfigForTests();
  };

  it("varsayılan kapalı → sınıflandırıcı yok, LLM çağrılmaz", () => {
    expect(getMessageRiskClassifier()).toBeUndefined();
    expect(state.calls).toBe(0);
  });

  it("açık ama LLM demo modunda → sınıflandırıcı yok", () => {
    enable();
    state.mode = "demo";
    expect(getMessageRiskClassifier()).toBeUndefined();
  });

  it("canlı: etiket ek sinyal olarak döner, karar kurallarda kalır", async () => {
    enable();
    const classify = getMessageRiskClassifier();
    expect(classify).toBeDefined();
    const r = await scanMessage("Merhaba, saat kaçta giriş yapabiliriz?", { classify });
    expect(r.llmSignal).toBe("SUSPICIOUS");
    expect(r.level).toBe("NONE");
    expect(r.blocked).toBe(false);
  });

  it("fallback (timeout vb.) → sinyal yok", async () => {
    enable();
    state.result = { data: { label: "BENIGN" }, llmMode: "fallback" };
    const classify = getMessageRiskClassifier();
    await expect(classify!("x")).resolves.toBeNull();
  });
});
