import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

/**
 * Altyapı dosyaları için statik regresyon testleri (Dockerfile, compose, CI, .env.example).
 * Bu kurallar bir kez kırıldığında sessizce geri gelebildiği için kod gibi test edilir.
 */
const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("regression: #14 Docker imajı", () => {
  const dockerfile = read("Dockerfile");

  it("sırlar build ARG/ENV olarak imaja gömülmez", () => {
    expect(dockerfile).not.toMatch(
      /^\s*ARG\s+(DATABASE_URL|REDIS_URL|JWT_SECRET|NEXTAUTH|.*SECRET)/m
    );
    expect(dockerfile).not.toMatch(/^\s*ENV\s+.*(SECRET|PASSWORD|DATABASE_URL)/m);
  });

  it("web imajına dev node_modules kopyalanmaz; non-root + HEALTHCHECK", () => {
    const web = dockerfile.slice(dockerfile.indexOf("AS web"), dockerfile.indexOf("AS worker"));
    expect(web).not.toMatch(/COPY --from=(builder|deps)[^\n]*node_modules/);
    expect(web).toMatch(/USER nextjs/);
    expect(web).toMatch(/HEALTHCHECK[\s\S]*\/api\/health/);
    expect(dockerfile).toMatch(/npm ci --omit=dev/);
  });

  it("public/ dizini var (COPY kırılmaz), .dockerignore .env* dışlar", () => {
    expect(() => statSync(path.join(root, "public"))).not.toThrow();
    const ignore = read(".dockerignore");
    expect(ignore).toMatch(/^\.env$/m);
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
  });
});

describe("regression: #15 compose ve CI", () => {
  const compose = read("docker-compose.yml");

  it("Postgres/Redis host'a açılmaz, Redis parolalı, varsayılan sır yok", () => {
    const dbBlock = compose.slice(compose.indexOf("\n  db:"), compose.indexOf("\n  redis:"));
    const redisBlock = compose.slice(
      compose.indexOf("\n  redis:"),
      compose.indexOf("\n  migrate:")
    );
    expect(dbBlock).not.toMatch(/ports:/);
    expect(redisBlock).not.toMatch(/ports:/);
    expect(redisBlock).toMatch(/--requirepass/);
    expect(compose).not.toMatch(/change-me/);
  });

  it("worker ayrı build target'ı kullanır; gRPC yalnızca iç ağda", () => {
    expect(compose).toMatch(/target: worker/);
    const grpcBlock = compose.slice(
      compose.indexOf("\n  grpc:"),
      compose.indexOf("\n  prometheus:")
    );
    expect(grpcBlock).not.toMatch(/ports:/);
    expect(grpcBlock).toMatch(/expose:/);
  });

  it("CI pgvector içermeyen postgres imajı kullanmaz", () => {
    const workflows = readdirSync(path.join(root, ".github/workflows"));
    for (const wf of workflows) {
      expect(read(`.github/workflows/${wf}`)).not.toMatch(/postgres:16-alpine/);
    }
  });
});

describe("regression: #21 .env.example eksiksiz", () => {
  it("kodda okunan her ortam değişkeni .env.example'da adıyla yer alır", () => {
    const example = read(".env.example");
    const files = [
      ...walk(path.join(root, "src")),
      ...walk(path.join(root, "services")),
      ...walk(path.join(root, "scripts")),
    ];
    const ignored = new Set([
      "NODE_ENV",
      "NEXT_RUNTIME",
      "VITEST",
      "SKIP_DOTENV",
      "SERVICE_NAME",
      "INTEGRATION_SKIP_REASON",
      // Yalnızca konteyner içi (secrets-init birimi)
      "KEYFILE_DIR",
    ]);
    const missing = new Set<string>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (!ignored.has(m[1]) && !new RegExp(`^#?\\s*${m[1]}=`, "m").test(example))
          missing.add(m[1]);
      }
    }
    // app-config şemasındaki anahtarlar da belgelenmeli
    const appConfig = read("src/lib/config/app-config.ts");
    for (const m of appConfig.matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm)) {
      if (!new RegExp(`^#?\\s*${m[1]}=`, "m").test(example)) missing.add(m[1]);
    }
    expect([...missing]).toEqual([]);
  });

  it("kullanılmayan NEXTAUTH_* adları kaldırıldı; .env.example'da gerçek sır değeri yok", () => {
    const example = read(".env.example");
    expect(example).not.toMatch(/NEXTAUTH_/);
    for (const name of [
      "JWT_SECRET",
      "INTERNAL_API_SECRET",
      "TRANSFER_SIGNING_SECRET",
      "PSP_WEBHOOK_SECRET",
      "LLM_API_KEY",
    ]) {
      expect(example).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });
});

describe("regression: v3#16 compose ortak ortam", () => {
  const compose = read("docker-compose.yml");

  it("ortak env anchor'ı tek yerde; servisler environment'ı GENİŞLETİR, ezmez", () => {
    expect(compose).toMatch(/^x-common-env: &common-env$/m);
    const common = compose.slice(compose.indexOf("x-common-env"), compose.indexOf("x-app-env"));
    for (const key of ["CHANNEL_FEED_SECRET", "COOKIE_SECURE", "DEMO_MODE", "JWT_SECRET"]) {
      expect(common).toContain(`${key}:`);
    }
    // Servis düzeyinde her `environment:` bloğu ortak haritayı birleştirerek başlar.
    const services = compose.slice(compose.indexOf("\nservices:"));
    const appServices = ["migrate", "app", "worker", "grpc"];
    for (const name of appServices) {
      const start = services.indexOf(`\n  ${name}:`);
      const next = services.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
      const block = services.slice(start, next === -1 ? undefined : start + 1 + next);
      const envAt = block.indexOf("\n    environment:");
      if (envAt !== -1) {
        expect(block.slice(envAt, envAt + 60)).toMatch(/environment:\n\s+<<: \*common-env/);
      } else {
        expect(block).toMatch(/<<: \*app-env/);
      }
    }
  });

  it("Prometheus/Grafana host portları ayarlanabilir", () => {
    expect(compose).toMatch(/\$\{PROMETHEUS_PORT:-9090\}:9090/);
    expect(compose).toMatch(/\$\{GRAFANA_PORT:-3001\}:3000/);
  });

  it("eski DEMO_SEED bayrağı kaldırıldı; DEMO_MODE kullanılır", () => {
    expect(compose).not.toMatch(/DEMO_SEED/);
    expect(read(".env.example")).toMatch(/^DEMO_MODE=/m);
  });
});

describe("regression: v3#17 ölü kod/ayar", () => {
  it("kullanılmayan Elasticsearch istemcisi ve compose `search` profili kaldırıldı", () => {
    expect(() => statSync(path.join(root, "src/lib/search/elastic.ts"))).toThrow();
    expect(read("docker-compose.yml")).not.toMatch(/elasticsearch/i);
    expect(read(".env.example")).not.toMatch(/ELASTICSEARCH_URL/);
  });
});
