import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getJwtSecret, isWeakJwtSecret } from "@/lib/auth/tokens";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

describe("regression: v4#5 güvensiz compose varsayılanları", () => {
  const env = process.env as Record<string, string | undefined>;
  const KEY = "JWT_SECRET";
  const saved = { nodeEnv: env.NODE_ENV, secret: env[KEY] };
  const setSecret = (value: string | undefined) => {
    env[KEY] = value;
  };
  afterEach(() => {
    env.NODE_ENV = saved.nodeEnv;
    setSecret(saved.secret);
  });

  it("temel compose güvenli: Secure çerez ve DEMO_MODE kapalı varsayılan", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/COOKIE_SECURE: \$\{COOKIE_SECURE:-true\}/);
    expect(compose).toMatch(/DEMO_MODE: \$\{DEMO_MODE:-false\}/);
    expect(compose).not.toMatch(/DEMO_MODE: \$\{DEMO_MODE:-true\}/);
  });

  it("demo ayarları yalnızca docker-compose.demo.yml override'ında", () => {
    const demo = read("docker-compose.demo.yml");
    expect(demo).toMatch(/DEMO_MODE: "true"/);
    expect(demo).toMatch(/COOKIE_SECURE: "false"/);
    for (const svc of ["migrate", "app", "worker", "grpc"]) {
      expect(demo).toMatch(new RegExp(`\\n  ${svc}:\\n    environment: \\*demo-env`));
    }
    // .env.example'dan kopyalanan .env compose interpolasyonunda demo'yu açmamalı.
    expect(read(".env.example")).toMatch(/^DEMO_MODE=$/m);
    // e2e demo override'ıyla koşar.
    expect(read(".github/workflows/ci.yml")).toMatch(
      /COMPOSE_FILE: docker-compose\.yml:docker-compose\.demo\.yml/
    );
  });

  it("JWT_SECRET gücü test dışındaki her ortamda (development dahil) kontrol edilir", () => {
    setSecret("change-me");
    env.NODE_ENV = "development";
    expect(() => getJwtSecret()).toThrow(/zayıf/);
    env.NODE_ENV = "production";
    expect(() => getJwtSecret()).toThrow(/zayıf/);
    env.NODE_ENV = "test";
    expect(() => getJwtSecret()).not.toThrow();
    env.NODE_ENV = "development";
    setSecret("k".repeat(16));
    expect(() => getJwtSecret()).toThrow();
    setSecret("x".repeat(40));
    expect(() => getJwtSecret()).not.toThrow();
    expect(isWeakJwtSecret("test-secret")).toBe(true);
  });

  it("DEMO şeridi kalıcı (sticky) ve TR/EN çevirili", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/data-testid="demo-ribbon"/);
    expect(layout).toMatch(/sticky top-0/);
    for (const locale of ["tr", "en"]) {
      const common = JSON.parse(read(`messages/${locale}/common.json`)) as {
        demo: Record<string, string>;
      };
      expect(common.demo.tag).toBe("DEMO");
      expect(common.demo.banner.length).toBeGreaterThan(0);
      expect(common.demo.ariaLabel.length).toBeGreaterThan(0);
    }
  });

  it("dev mailbox yalnızca oturum sahibinin mesajlarını sorgular (ADMIN istisnası yok)", () => {
    const route = read("src/app/api/dev/mailbox/route.ts");
    expect(route).toMatch(/where: \{ userId: claims\.userId \}/);
    expect(route).not.toMatch(/role === "ADMIN"/);
  });
});
