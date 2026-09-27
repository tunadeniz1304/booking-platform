import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  opts: [] as Array<{ subject?: string }>,
}));

vi.mock("@/lib/llm/client", () => ({
  getLlmClient: () => ({
    settings: { effectiveMode: "live" },
    completeJson: async (_task: string, _schema: unknown, _msgs: unknown, opts: object) => {
      state.opts.push(opts);
      return { data: { label: "BENIGN" }, llmMode: "live" };
    },
  }),
}));

import { resetConfigForTests } from "@/lib/config/app-config";
import { scanOutgoingMessage } from "@/lib/trust/message-risk";

/**
 * v2-P0-4 — mesaj taraması (message_risk) LLM çağrısı bütçesiz değil: gönderen
 * kullanıcının öznesiyle (`u:<senderId>`) faturalanır.
 */
describe("regression: v2-P0-4 mesaj taraması gönderenin bütçesinden düşer", () => {
  afterEach(() => {
    delete process.env.MESSAGE_SCAN_LLM_ENABLED;
    resetConfigForTests();
    state.opts = [];
  });

  it("scanOutgoingMessage LLM sınıflandırıcısını gönderen öznesiyle çağırır", async () => {
    process.env.MESSAGE_SCAN_LLM_ENABLED = "true";
    resetConfigForTests();
    const scan = await scanOutgoingMessage("Merhaba, giriş saati kaç?", "sender-1");
    expect(scan.llmSignal).toBe("BENIGN");
    expect(state.opts).toHaveLength(1);
    expect(state.opts[0].subject).toBe("u:sender-1");
  });
});
