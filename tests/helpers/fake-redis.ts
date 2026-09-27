import type { RedisClient } from "@/lib/redis";

/**
 * Birim testleri için bellek-içi `RedisClient`. TTL'ler gerçek saatle değil
 * yalnızca kayıt amaçlı tutulur; `failing = true` iken her komut hata fırlatır
 * (fail-open / fail-closed davranışını test etmek için).
 */
export class FakeRedis implements RedisClient {
  store = new Map<string, string>();
  sets = new Map<string, Set<string>>();
  lists = new Map<string, string[]>();
  ttls = new Map<string, number>();
  published: Array<{ channel: string; message: string }> = [];
  failing = false;
  calls: string[] = [];

  private guard(cmd: string): void {
    this.calls.push(cmd);
    if (this.failing) throw new Error("redis down");
  }

  async mget(keys: string[]) {
    return Promise.all(keys.map((k) => this.get(k)));
  }

  async get(key: string) {
    this.guard("get");
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, opts?: { ex?: number; nx?: boolean }) {
    this.guard("set");
    if (opts?.nx && this.store.has(key)) return null;
    this.store.set(key, value);
    if (opts?.ex) this.ttls.set(key, opts.ex);
    return "OK";
  }
  async getdel(key: string) {
    this.guard("getdel");
    const v = this.store.get(key) ?? null;
    this.store.delete(key);
    return v;
  }
  async del(...keys: string[]) {
    this.guard("del");
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k) || this.sets.delete(k) || this.lists.delete(k)) n += 1;
    }
    return n;
  }
  async ttl(key: string) {
    this.guard("ttl");
    return this.ttls.get(key) ?? -1;
  }
  async exists(key: string) {
    this.guard("exists");
    return this.store.has(key) || this.sets.has(key) ? 1 : 0;
  }
  async incr(key: string) {
    this.guard("incr");
    const v = Number(this.store.get(key) ?? "0") + 1;
    this.store.set(key, String(v));
    return v;
  }
  async expire(key: string, seconds: number) {
    this.guard("expire");
    this.ttls.set(key, seconds);
    return 1;
  }
  async incrWithTtl(key: string, seconds: number) {
    const v = await this.incr(key);
    if (v === 1) this.ttls.set(key, seconds);
    return v;
  }
  /**
   * Yalnızca HyperLogLog betikleri (PFADD+TTL / PFCOUNT) kesin küme ile ve LLM bütçe
   * betikleri (rezervasyon / düzeltme) taklit edilir. Betik gövdesi eşzamanlı (await'siz)
   * çalışır → Redis'teki gibi atomik.
   */
  async eval(script = "", keys: string[] = [], args: string[] = []): Promise<unknown> {
    this.guard("eval");
    if (script.includes("llm-budget-reserve")) {
      const cur = Number(this.store.get(keys[0]) ?? "0");
      if (cur >= Number(args[2])) return 0;
      this.store.set(keys[0], String(cur + Number(args[0])));
      if (!this.ttls.has(keys[0])) this.ttls.set(keys[0], Number(args[1]));
      return 1;
    }
    if (script.includes("llm-budget-adjust")) {
      const v = Math.max(0, Number(this.store.get(keys[0]) ?? "0") + Number(args[0]));
      this.store.set(keys[0], String(v));
      if (!this.ttls.has(keys[0])) this.ttls.set(keys[0], Number(args[1]));
      return v;
    }
    if (script.includes("'PFADD'")) {
      const added = await this.sadd(keys[0], args[0]);
      if (args[1]) this.ttls.set(keys[0], Number(args[1]));
      return added > 0 ? 1 : 0;
    }
    if (script.includes("'PFCOUNT'")) {
      const union = new Set<string>();
      keys.forEach((k) => this.sets.get(k)?.forEach((m) => union.add(m)));
      return union.size;
    }
    throw new Error("FakeRedis.eval desteklenmiyor");
  }
  async sadd(key: string, ...members: string[]) {
    this.guard("sadd");
    const s = this.sets.get(key) ?? new Set<string>();
    const before = s.size;
    members.forEach((m) => s.add(m));
    this.sets.set(key, s);
    return s.size - before;
  }
  async srem(key: string, ...members: string[]) {
    this.guard("srem");
    const s = this.sets.get(key);
    if (!s) return 0;
    let n = 0;
    members.forEach((m) => {
      if (s.delete(m)) n += 1;
    });
    return n;
  }
  async smembers(key: string) {
    this.guard("smembers");
    return [...(this.sets.get(key) ?? [])];
  }
  async scard(key: string) {
    this.guard("scard");
    return this.sets.get(key)?.size ?? 0;
  }
  async lpush(key: string, ...values: string[]) {
    this.guard("lpush");
    const l = this.lists.get(key) ?? [];
    l.unshift(...values.reverse());
    this.lists.set(key, l);
    return l.length;
  }
  async ltrim(key: string, start: number, stop: number) {
    this.guard("ltrim");
    const l = this.lists.get(key) ?? [];
    this.lists.set(key, l.slice(start, stop + 1));
    return "OK";
  }
  async lrange(key: string, start: number, stop: number) {
    this.guard("lrange");
    const l = this.lists.get(key) ?? [];
    return l.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async publish(channel: string, message: string) {
    this.guard("publish");
    this.published.push({ channel, message });
    return 1;
  }
  async ping() {
    this.guard("ping");
    return "PONG";
  }
}
