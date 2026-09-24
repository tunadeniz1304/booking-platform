"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api-client";
import { formatDate } from "@/lib/ui/format";
import {
  Button,
  Card,
  Field,
  LlmBadge,
  Status,
  errorMessage,
  inputClass,
  useLoader,
} from "@/components/ui/ui";

interface OutboxState {
  counts: Record<string, number>;
  dead: Array<{
    id: string;
    eventType: string;
    aggregateId: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
}

interface DemandEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  impact: number;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "ROLLED_BACK";
  category: string | null;
  rationale: string | null;
  source: string | null;
  location: { city: string };
}

interface FraudCheck {
  id: string;
  bookingId: string;
  userId: string;
  score: number;
  decision: string;
  reasons: unknown;
  createdAt: string;
}

interface LlmStatus {
  mode: string;
  effectiveMode: string;
  model: string;
  baseUrlHost: string;
  hasKey: boolean;
  jsonModeSupported: boolean | null;
  lastError: string | null;
}

type Feedback = { error?: string; message?: string };

const EVENT_STATUS: Record<DemandEvent["status"], string> = {
  PROPOSED: "Önerildi",
  APPROVED: "Onaylı",
  REJECTED: "Reddedildi",
  ROLLED_BACK: "Geri alındı",
};

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <LlmStatusCard />
      <OutboxCard />
      <EventsCard />
      <FraudCard />
      <RoleCard />
    </div>
  );
}

function LlmStatusCard() {
  const { data, error } = useLoader(() => apiFetch<LlmStatus>("/api/llm/status"));
  return (
    <Card title="LLM durumu" id="llm-status">
      <Status error={error} />
      {data && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-800 md:grid-cols-4">
          <dt className="font-medium">Ayar</dt>
          <dd>{data.mode}</dd>
          <dt className="font-medium">Etkin mod</dt>
          <dd>
            <LlmBadge mode={data.effectiveMode} />
          </dd>
          <dt className="font-medium">Model</dt>
          <dd>{data.model}</dd>
          <dt className="font-medium">Sunucu</dt>
          <dd>{data.baseUrlHost || "—"}</dd>
          <dt className="font-medium">Anahtar tanımlı</dt>
          <dd>{data.hasKey ? "Evet" : "Hayır"}</dd>
          <dt className="font-medium">JSON modu</dt>
          <dd>
            {data.jsonModeSupported === null
              ? "Bilinmiyor"
              : data.jsonModeSupported
                ? "Var"
                : "Yok"}
          </dd>
          <dt className="font-medium">Son hata</dt>
          <dd className="col-span-1 md:col-span-3">{data.lastError ?? "—"}</dd>
        </dl>
      )}
    </Card>
  );
}

function OutboxCard() {
  const { data, error, reload } = useLoader(() => apiFetch<OutboxState>("/api/admin/outbox"));
  const [feedback, setFeedback] = useState<Feedback>({});

  async function requeue(id: string) {
    setFeedback({});
    try {
      await apiFetch("/api/admin/outbox", { method: "POST", body: JSON.stringify({ id }) });
      setFeedback({ message: "Mesaj yeniden kuyruğa alındı." });
      reload();
    } catch (e) {
      setFeedback({ error: errorMessage(e) });
    }
  }

  return (
    <Card title="Outbox" id="outbox">
      <Status error={error ?? feedback.error} message={feedback.message} />
      {data && (
        <>
          <ul className="flex flex-wrap gap-3 text-sm">
            {Object.entries(data.counts).map(([status, count]) => (
              <li key={status} className="rounded-md bg-gray-100 px-3 py-1 text-gray-900">
                {status}: <strong>{count}</strong>
              </li>
            ))}
            {Object.keys(data.counts).length === 0 && <li>Outbox boş.</li>}
          </ul>
          <h3 className="mt-4 text-base font-semibold text-gray-900">DEAD mesajlar</h3>
          {data.dead.length === 0 ? (
            <p className="text-sm text-gray-700">DEAD mesaj yok.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.dead.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <span>
                    <strong>{m.eventType}</strong> · {m.aggregateId} · {m.attempts} deneme ·{" "}
                    {formatDate(m.createdAt)}
                    {m.lastError && (
                      <span className="block text-xs text-red-800">{m.lastError}</span>
                    )}
                  </span>
                  <Button variant="secondary" onClick={() => requeue(m.id)}>
                    Yeniden kuyruğa al
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function EventsCard() {
  const { data, error, reload } = useLoader(() => apiFetch<DemandEvent[]>("/api/admin/events"));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({});
  const [lastMode, setLastMode] = useState<string | null>(null);

  async function propose(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback({});
    try {
      const res = await apiFetch<{ event: DemandEvent; llmMode: string }>("/api/admin/events", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setLastMode(res.llmMode);
      setFeedback({ message: `Öneri oluşturuldu: ${res.event.title}` });
      setText("");
      reload();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "approve" | "reject" | "rollback") {
    setFeedback({});
    try {
      await apiFetch(`/api/admin/events/${id}/${action}`, { method: "POST", body: "{}" });
      setFeedback({ message: "İşlem uygulandı." });
      reload();
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    }
  }

  return (
    <Card title="Olay sinyali kuyruğu" id="events">
      <form onSubmit={propose} className="space-y-2">
        <Field
          label="Metinden olay öner"
          id="event-text"
          hint="Ör. haber metni: 'İzmir'de 12–15 Ekim arası uluslararası fuar düzenlenecek.' Öneri onaylanmadan fiyata yansımaz."
        >
          <textarea
            id="event-text"
            rows={3}
            className={inputClass}
            value={text}
            minLength={10}
            maxLength={2000}
            required
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>
            {busy ? "Çıkarılıyor…" : "Öneri oluştur"}
          </Button>
          <LlmBadge mode={lastMode} />
        </div>
      </form>
      <div className="mt-3">
        <Status error={error ?? feedback.error} message={feedback.message} />
      </div>
      {data && data.length === 0 && <p className="text-sm text-gray-700">Olay yok.</p>}
      {data && data.length > 0 && (
        <ul className="mt-2 space-y-2">
          {data.map((ev) => (
            <li key={ev.id} className="rounded-md border p-3 text-sm text-gray-900">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{ev.title}</strong> · {ev.location.city} · {formatDate(ev.startsAt)}–
                  {formatDate(ev.endsAt)} · etki {ev.impact}/10 · {EVENT_STATUS[ev.status]}
                </span>
                <span className="flex gap-2">
                  {ev.status === "PROPOSED" && (
                    <>
                      <Button onClick={() => act(ev.id, "approve")}>Onayla</Button>
                      <Button variant="secondary" onClick={() => act(ev.id, "reject")}>
                        Reddet
                      </Button>
                    </>
                  )}
                  {ev.status === "APPROVED" && (
                    <Button variant="danger" onClick={() => act(ev.id, "rollback")}>
                      Geri al
                    </Button>
                  )}
                </span>
              </div>
              {ev.rationale && <p className="mt-1 text-xs text-gray-700">{ev.rationale}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function reasonsText(reasons: unknown): string {
  if (Array.isArray(reasons)) {
    return reasons
      .map((r) =>
        typeof r === "string"
          ? r
          : r && typeof r === "object" && "code" in r
            ? String((r as { code: unknown }).code)
            : JSON.stringify(r)
      )
      .join(", ");
  }
  return reasons ? JSON.stringify(reasons) : "—";
}

function FraudCard() {
  const { data, error, reload } = useLoader(() => apiFetch<FraudCheck[]>("/api/admin/fraud"));
  const [feedback, setFeedback] = useState<Feedback>({});

  async function resolve(id: string, resolution: "legit" | "fraud") {
    setFeedback({});
    try {
      await apiFetch("/api/admin/fraud", {
        method: "POST",
        body: JSON.stringify({ id, resolution }),
      });
      setFeedback({ message: "Karar kaydedildi." });
      reload();
    } catch (e) {
      setFeedback({ error: errorMessage(e) });
    }
  }

  return (
    <Card title="Fraud inceleme kuyruğu" id="fraud">
      <Status error={error ?? feedback.error} message={feedback.message} />
      {data?.length === 0 && <p className="text-sm text-gray-700">İncelenecek kayıt yok.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span>
                Rezervasyon {f.bookingId} · kullanıcı {f.userId} · skor <strong>{f.score}</strong> ·{" "}
                {f.decision}
                <span className="block text-xs text-gray-700">
                  Kurallar: {reasonsText(f.reasons)}
                </span>
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => resolve(f.id, "legit")}>
                  Meşru
                </Button>
                <Button variant="danger" onClick={() => resolve(f.id, "fraud")}>
                  Dolandırıcılık
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RoleCard() {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"USER" | "HOST" | "ADMIN">("HOST");
  const [feedback, setFeedback] = useState<Feedback>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFeedback({});
    try {
      const res = await apiFetch<{ id: string; role: string }>(
        `/api/admin/users/${encodeURIComponent(userId.trim())}/role`,
        { method: "PATCH", body: JSON.stringify({ role }) }
      );
      setFeedback({ message: `Rol güncellendi: ${res.role} (en geç 15 dk içinde yansır).` });
    } catch (err) {
      setFeedback({ error: errorMessage(err) });
    }
  }

  return (
    <Card title="Kullanıcı rolü değiştir" id="roles">
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
        <Field label="Kullanıcı kimliği" id="role-user" hint="Kendi rolünüzü değiştiremezsiniz.">
          <input
            id="role-user"
            className={inputClass}
            value={userId}
            required
            onChange={(e) => setUserId(e.target.value)}
          />
        </Field>
        <Field label="Yeni rol" id="role-value">
          <select
            id="role-value"
            className={inputClass}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="USER">USER</option>
            <option value="HOST">HOST</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </Field>
        <div className="flex items-end">
          <Button type="submit">Rolü güncelle</Button>
        </div>
      </form>
      <div className="mt-2">
        <Status error={feedback.error} message={feedback.message} />
      </div>
    </Card>
  );
}
