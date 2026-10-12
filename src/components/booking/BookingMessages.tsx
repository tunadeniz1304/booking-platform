"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { useFormat } from "@/i18n/use-format";
import { Button, LlmBadge, focusRing, loginHref, useErrorText } from "@/components/ui/ui";

interface Msg {
  id: string;
  senderId: string;
  senderRole: string;
  body: string;
  maskedKinds: string[];
  fromAiDraft: boolean;
  createdAt: string;
  /** P1-6 dolandırıcılık taraması (alıcıya uyarı bandı, gönderene nötr not olarak gösterilir). */
  risk?: { level: "WARN" | "HIGH"; reasons: string[] } | null;
}

interface ThreadResponse {
  role: "GUEST" | "HOST";
  canWrite: boolean;
  messages: Msg[];
  /** Sunucu sınırı (MESSAGE_MAX_LENGTH); eski yanıtlarda yoksa varsayılan kullanılır. */
  maxLength?: number;
  /** Bu sayfadan daha eski mesaj var mı (`?before=<id>` ile yüklenir). */
  hasMore?: boolean;
  /** Konuşma bağlamı (ev sahibi sayfasında `showContext` ile özet olarak gösterilir). */
  context?: {
    propertyTitle: string;
    roomName: string;
    guestFirstName: string;
    checkIn: string;
    checkOut: string;
    status: string;
    guestCount: number;
  };
}

type ThreadState = ThreadResponse & { bookingId: string };
type LiveState = "live" | "reconnecting" | "stopped";
type PendingDraft = { text: string; mode: string | null; language: string | null };
type DraftResponse = { draft: string; llmMode?: string; language?: "tr" | "en" };
type LoadError = { message: string; retryable: boolean };

/** Sunucu varsayılanı (app-config MESSAGE_MAX_LENGTH); yanıt `maxLength` verirse o geçerlidir. */
const MESSAGE_MAX_LENGTH_FALLBACK = 2000;
/** Sınırın bu oranından sonra ekran okuyucuya bir kez "yaklaşıyorsunuz" duyurulur. */
const LIMIT_WARN_RATIO = 0.9;
/** Canlı bağlantı yokken yedek yoklama aralığı. */
const FALLBACK_POLL_MS = 30_000;
/** Yeni gelen mesaj duyurusunda okunan en fazla karakter. */
const ANNOUNCE_MAX_CHARS = 140;

interface DayGroup {
  key: string;
  first: string;
  messages: Msg[];
}

/** Yerel takvim günü (YYYY-MM-DD); gün ayracı ve `<time dateTime>` için. */
function localDayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Gün anahtarı bugün ya da dün ise ilgili çeviri anahtarı; değilse null. */
function relativeDay(key: string): "today" | "yesterday" | null {
  const now = new Date();
  if (key === localDayKey(now)) return "today";
  now.setDate(now.getDate() - 1);
  return key === localDayKey(now) ? "yesterday" : null;
}

/** Tarayıcı saat dilimi; gün başlığı ile mesaj saatleri aynı takvim gününe göre gösterilir. */
function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Sıralı mesajları yerel güne göre ardışık gruplara böler. */
function groupByDay(messages: Msg[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const m of messages) {
    const key = localDayKey(new Date(m.createdAt));
    const last = groups[groups.length - 1];
    if (last?.key === key) last.messages.push(m);
    else groups.push({ key, first: m.createdAt, messages: [m] });
  }
  return groups;
}

/** Kimliğe göre birleştirir (tekrarları atar) ve zamana göre sıralar; değişiklik yoksa `prev`. */
function mergeMessages(prev: Msg[], incoming: Msg[]): Msg[] {
  const known = new Set(prev.map((m) => m.id));
  const extra: Msg[] = [];
  for (const m of incoming) {
    if (known.has(m.id)) continue;
    known.add(m.id);
    extra.push(m);
  }
  if (extra.length === 0) return prev;
  return [...prev, ...extra].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Rezervasyon yazışması (P1-6). Canlı güncelleme SSE ile (çerez kimliği); iletişim
 * bilgileri sunucuda maskelenir. Ev sahibi yapay zekâ taslağı isteyebilir, ancak
 * taslak yalnızca kutuya yazılır — göndermek ev sahibinin onayıdır. Kutu doluysa
 * taslak ayrı öneri olarak gösterilir; yazılan metin onaysız ezilmez.
 */
export default function BookingMessages({
  bookingId,
  divider = true,
  showContext = false,
}: {
  bookingId: string;
  /** Üstte ayırıcı çizgi; kart içinde tek bölüm olarak kullanılınca kapatılır. */
  divider?: boolean;
  /** Rezervasyon özetini (ilan, tarihler, misafir, durum) listenin üstünde gösterir. */
  showContext?: boolean;
}) {
  const t = useTranslations("chat");
  const tt = useTranslations("trust");
  const th = useTranslations("host");
  const f = useFormat();
  const errorText = useErrorText();
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [text, setText] = useState("");
  const [fromDraft, setFromDraft] = useState(false);
  const [draftMode, setDraftMode] = useState<string | null>(null);
  const [draftLanguage, setDraftLanguage] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null);
  const [undoText, setUndoText] = useState<string | null>(null);
  const [busy, setBusy] = useState<"send" | "draft" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitTried, setLimitTried] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>("live");
  const [reloadKey, setReloadKey] = useState(0);
  /** Yalnız karşı taraftan yeni gelen mesajın kısa duyurusu (liste kendisi duyurmaz). */
  const [announcement, setAnnouncement] = useState("");
  /** Canlı gelen yüksek riskli mesaj ise acil duyuru (geçmiş uyarılar okunmaz). */
  const [alertText, setAlertText] = useState("");
  /** Yüklenen en eski sayfanın ardında daha eski mesaj var mı (son sayfa yenilemesi ezmez). */
  const [older, setOlder] = useState<{ bookingId: string; hasMore: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderFailed, setOlderFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftBoxRef = useRef<HTMLDivElement>(null);
  /** Eski mesajlar eklenince görünen ilk mesaj yerinde kalsın diye önceki kaydırma ölçüleri. */
  const keepScroll = useRef<{ height: number; top: number; focusList: boolean } | null>(null);
  /** Gönderim/taslak sürerken yazılanı kaybetmemek için güncel metin. */
  const textRef = useRef("");
  /** Kullanıcı listenin dibindeyse (ya da kendi mesajını gönderdiyse) yeni mesajda dibe kaydırılır. */
  const stickToBottom = useRef(true);
  /** Görülmüş mesaj kimlikleri; ilk yükleme sessizce kaydedilir, sonra gelenler duyurulur. */
  const seen = useRef<{ bookingId: string; role: string; ids: Set<string> } | null>(null);
  const sectionClass = divider ? "border-t border-gray-100 pt-6" : undefined;
  const threadUrl = `/api/bookings/${bookingId}/messages`;

  /** Sunucu metnini doğrudan basmak yerine bilinen durumları çeviriyle eşler. */
  const describeError = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError) {
        if (err.status === 403 || err.status === 404) return t("notFound");
        if (!err.code) return fallback;
      }
      return errorText(err);
    },
    [errorText, t]
  );

  /** Engellenen mesajda hangi içeriğin sorun olduğunu (sunucu `details.reasons`) söyler. */
  function blockedText(err: ApiError): string {
    const raw = (err.details as { reasons?: unknown } | undefined)?.reasons;
    const codes = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
    const reasons = codes.filter((r) => tt.has(`reasons.${r}`)).map((r) => tt(`reasons.${r}`));
    const parts = [tt("message.blocked")];
    if (reasons.length > 0) parts.push(`${tt("message.reasonsLabel")} ${reasons.join(", ")}.`);
    parts.push(t("blockedHint"));
    return parts.join(" ");
  }

  const riskReasons = useCallback(
    (reasons: string[]) =>
      reasons.map((r) => (tt.has(`reasons.${r}`) ? tt(`reasons.${r}`) : r)).join(", "),
    [tt]
  );

  const add = useCallback((m: Msg) => {
    setThread((prev) => (prev ? { ...prev, messages: mergeMessages(prev.messages, [m]) } : prev));
  }, []);

  /** Karşı taraftan yeni gelen (daha önce görülmemiş) mesajları kısa bir durum metniyle duyurur. */
  const announceIncoming = useCallback(
    (messages: Msg[], role?: string) => {
      const s = seen.current;
      if (!s || s.bookingId !== bookingId) {
        if (role) seen.current = { bookingId, role, ids: new Set(messages.map((m) => m.id)) };
        return;
      }
      const fresh = messages.filter((m) => !s.ids.has(m.id));
      for (const m of fresh) s.ids.add(m.id);
      const incoming = fresh.filter((m) => m.senderRole !== s.role);
      if (incoming.length === 0) return;
      // Yüksek riskli yeni mesaj acil (alert) duyurulur; diğerleri nazik durum metniyle.
      const high = incoming.some((m) => m.risk?.level === "HIGH");
      const announce = high ? setAlertText : setAnnouncement;
      if (incoming.length > 1) {
        const count = t("newMessages", { count: incoming.length });
        announce(high ? `${count} ${tt("message.highTitle")}` : count);
        return;
      }
      const m = incoming[0];
      const body =
        m.body.length > ANNOUNCE_MAX_CHARS ? `${m.body.slice(0, ANNOUNCE_MAX_CHARS)}…` : m.body;
      const sender = m.senderRole === "HOST" ? t("host") : t("guest");
      const risk = m.risk
        ? ` ${m.risk.level === "HIGH" ? tt("message.highTitle") : tt("message.warnTitle")}`
        : "";
      announce(`${t("newMessage", { sender, body })}${risk}`);
    },
    [bookingId, t, tt]
  );

  /** GET yanıtını mevcut listeyle birleştirir (yeniden bağlanınca kaçırılanlar eklenir). */
  const applyThread = useCallback(
    (res: ThreadResponse, extra: Msg[] = []) => {
      announceIncoming([...res.messages, ...extra], res.role);
      setThread((prev) => {
        const known = prev?.bookingId === bookingId ? prev.messages : [];
        return { ...res, bookingId, messages: mergeMessages(known, [...res.messages, ...extra]) };
      });
    },
    [bookingId, announceIncoming]
  );

  function updateText(value: string) {
    textRef.current = value;
    setText(value);
  }

  useEffect(() => {
    let cancelled = false;
    let loaded = false;
    let opened = false;
    // İlk GET bitmeden gelen canlı olaylar atılmaz; yükleme bitince eklenir.
    let buffered: Msg[] = [];

    const fetchThread = () =>
      apiFetch<ThreadResponse>(threadUrl).then((res) => {
        if (cancelled) return;
        loaded = true;
        applyThread(res, buffered);
        buffered = [];
      });

    fetchThread().catch((err: unknown) => {
      if (cancelled) return;
      if (err instanceof ApiError && err.status === 401) {
        setNeedsLogin(true);
        return;
      }
      const missing = err instanceof ApiError && (err.status === 403 || err.status === 404);
      setLoadError({ message: describeError(err, t("loadFailed")), retryable: !missing });
    });

    const es = new EventSource(`${threadUrl}/stream`);
    es.addEventListener("message", (e) => {
      try {
        const m = JSON.parse((e as MessageEvent<string>).data) as Msg;
        if (loaded) {
          add(m);
          announceIncoming([m]);
        } else {
          buffered.push(m);
        }
      } catch {
        // bozuk olay yok sayılır
      }
    });
    es.addEventListener("open", () => {
      if (cancelled) return;
      setLiveState("live");
      // Kopukluk sırasında (ya da ilk GET ile abonelik arasında) gelenler GET ile yakalanır.
      if (opened || loaded) fetchThread().catch(() => {});
      opened = true;
    });
    es.addEventListener("error", () => {
      if (cancelled) return;
      // CLOSED: tarayıcı yeniden denemez (ör. 429 TOO_MANY_STREAMS); kullanıcıya düğme sunulur.
      setLiveState(es.readyState === EventSource.CLOSED ? "stopped" : "reconnecting");
    });
    return () => {
      cancelled = true;
      es.close();
    };
  }, [threadUrl, reloadKey, add, announceIncoming, applyThread, t, describeError]);

  const refetch = useCallback(() => {
    apiFetch<ThreadResponse>(threadUrl)
      .then((res) => applyThread(res))
      .catch(() => {});
  }, [threadUrl, applyThread]);

  // Canlı bağlantı yokken yedek yoklama; sekmeye dönünce (uyku/ağ değişimi sonrası) yakalama.
  const hasThread = thread !== null;
  useEffect(() => {
    if (!hasThread) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = liveState === "live" ? undefined : setInterval(refetch, FALLBACK_POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [hasThread, liveState, refetch]);

  // Yalnız liste kabı kaydırılır (sayfa değil); eski mesajları okuyan kullanıcının
  // görünümü gelen yeni mesajla çekilmez. Eski mesajlar üste eklenince görünüm korunur.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const keep = keepScroll.current;
    if (keep) {
      keepScroll.current = null;
      el.scrollTop = keep.top + (el.scrollHeight - keep.height);
      if (keep.focusList) el.focus({ preventScroll: true });
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);

  // Taslak önerisi açılınca odak öneri kutusuna gider (ekran okuyucu başlığı ve metni okur).
  useEffect(() => {
    if (pendingDraft) draftBoxRef.current?.focus();
  }, [pendingDraft]);

  function onListScroll() {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    const first = thread?.messages[0];
    if (loadingOlder || !thread || !first) return;
    setLoadingOlder(true);
    setOlderFailed(false);
    try {
      const res = await apiFetch<ThreadResponse>(
        `${threadUrl}?before=${encodeURIComponent(first.id)}`
      );
      const el = listRef.current;
      const hasMore = res.hasMore === true;
      // Düğme kalkacaksa (başka eski mesaj yok) odak kaybolmasın diye listeye taşınır.
      const focusList = !hasMore && !!el?.contains(document.activeElement);
      const known = new Set(thread.messages.map((m) => m.id));
      const added = res.messages.some((m) => !known.has(m.id));
      stickToBottom.current = false;
      if (el && added) {
        keepScroll.current = { height: el.scrollHeight, top: el.scrollTop, focusList };
      } else if (focusList) {
        el?.focus({ preventScroll: true });
      }
      setOlder({ bookingId, hasMore });
      setThread((prev) =>
        prev?.bookingId === bookingId
          ? { ...prev, messages: mergeMessages(prev.messages, res.messages) }
          : prev
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      else setOlderFailed(true);
    } finally {
      setLoadingOlder(false);
    }
  }

  function reconnect() {
    setLiveState("reconnecting");
    setReloadKey((k) => k + 1);
  }

  function retryLoad() {
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }

  const maxLength = thread?.maxLength ?? MESSAGE_MAX_LENGTH_FALLBACK;
  const overBy = text.trim().length - maxLength;
  const overLimit = text.length > maxLength;
  const nearLimit = !overLimit && text.length >= maxLength * LIMIT_WARN_RATIO;

  async function send(e: FormEvent) {
    e.preventDefault();
    // Düğme odakta kalsın diye `disabled` yerine aria-disabled + erken dönüş kullanılır.
    if (busy || !text.trim()) return;
    if (overBy > 0) {
      // Sınır istemcide denetlenir; metin korunur, hata alana bağlıdır.
      setLimitTried(true);
      inputRef.current?.focus();
      return;
    }
    const sent = text;
    setBusy("send");
    setError(null);
    try {
      const { message } = await apiFetch<{ message: Msg }>(threadUrl, {
        method: "POST",
        body: JSON.stringify({ body: sent, fromAiDraft: fromDraft }),
      });
      stickToBottom.current = true;
      add(message);
      // Gönderim sürerken eklenen metin silinmez; yalnız gönderilen kısım çıkarılır.
      const current = textRef.current;
      updateText(
        current === sent
          ? ""
          : current.startsWith(sent)
            ? current.slice(sent.length).trimStart()
            : current
      );
      setFromDraft(false);
      setDraftMode(null);
      setDraftLanguage(null);
      setUndoText(null);
      setPendingDraft(null);
      setLimitTried(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MESSAGE_BLOCKED") setError(blockedText(err));
      else if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      else setError(describeError(err, t("sendFailed")));
    } finally {
      setBusy(null);
      inputRef.current?.focus();
    }
  }

  async function draft() {
    if (busy) return;
    setBusy("draft");
    setError(null);
    setPendingDraft(null);
    let showSuggestion = false;
    try {
      const res = await apiFetch<DraftResponse>(`${threadUrl}/draft`, { method: "POST" });
      const mode = res.llmMode ?? null;
      const language = res.language ?? null;
      if (textRef.current.trim()) {
        // Yazılmış metin korunur; taslak ayrı öneri kutusunda onaya sunulur.
        showSuggestion = true;
        setPendingDraft({ text: res.draft, mode, language });
      } else {
        updateText(res.draft);
        setFromDraft(true);
        setDraftMode(mode);
        setDraftLanguage(language);
        setUndoText(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedsLogin(true);
      else setError(describeError(err, t("draftFailed")));
    } finally {
      setBusy(null);
      if (!showSuggestion) inputRef.current?.focus();
    }
  }

  function acceptDraft(how: "replace" | "append") {
    if (!pendingDraft) return;
    const previous = textRef.current;
    updateText(
      how === "append" && previous.trim()
        ? `${previous.trimEnd()}\n\n${pendingDraft.text}`
        : pendingDraft.text
    );
    setUndoText(previous.trim() ? previous : null);
    setFromDraft(true);
    setDraftMode(pendingDraft.mode);
    setDraftLanguage(pendingDraft.language);
    setPendingDraft(null);
    inputRef.current?.focus();
  }

  function dismissDraft() {
    setPendingDraft(null);
    inputRef.current?.focus();
  }

  function undoDraft() {
    if (undoText === null) return;
    updateText(undoText);
    setUndoText(null);
    setFromDraft(false);
    setDraftMode(null);
    setDraftLanguage(null);
    inputRef.current?.focus();
  }

  const loginPrompt = (
    <p className="mt-2 text-sm text-gray-700">
      {t.rich("loginRequired", {
        link: (chunks) => (
          <Link
            href={loginHref()}
            className={`font-semibold text-[#003580] underline ${focusRing}`}
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );

  if (!thread || thread.bookingId !== bookingId) {
    return (
      <section aria-labelledby="msg-title" className={sectionClass}>
        <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
          {t("title")}
        </h2>
        {needsLogin ? (
          loginPrompt
        ) : loadError ? (
          <div className="mt-2 space-y-2">
            <p role="alert" className="text-sm text-red-600">
              {loadError.message}
            </p>
            {loadError.retryable && (
              <Button variant="secondary" onClick={retryLoad} className="min-h-[44px] sm:min-h-0">
                {t("retry")}
              </Button>
            )}
          </div>
        ) : (
          <p role="status" className="mt-2 text-sm text-gray-500">
            {t("loading")}
          </p>
        )}
      </section>
    );
  }

  const sendDisabled = busy !== null || !text.trim();
  const shownError =
    limitTried && overBy > 0 ? t("tooLong", { max: maxLength, over: overBy }) : error;
  const describedBy = [
    "msg-safety",
    "msg-count",
    fromDraft ? "msg-ai-notice" : null,
    shownError ? "msg-error" : null,
  ]
    .filter(Boolean)
    .join(" ");
  /** Taslağın yazıldığı dil (misafirin dili arayüz dilinden farklı olabilir). */
  const languageNote = (language: string | null) =>
    language && t.has(`draftLanguageName.${language}`)
      ? ` ${t("draftLanguage", { language: t(`draftLanguageName.${language}`) })}`
      : "";
  const olderHasMore = older?.bookingId === bookingId ? older.hasMore : thread.hasMore === true;

  const myRole = thread.role;
  const timeZone = localTimeZone();
  const dayLabel = (day: DayGroup) => {
    const rel = relativeDay(day.key);
    return rel ? t(rel) : f.date(day.first, "long", timeZone);
  };

  const context = showContext ? thread.context : undefined;
  const contextRows: [string, string][] = [];
  if (context) {
    const statusKey = `bookingStatus.${context.status}`;
    const status = th.has(statusKey) ? th(statusKey) : context.status;
    const dates = th("messagesPage.context.datesValue", {
      checkIn: f.date(context.checkIn, "medium"),
      checkOut: f.date(context.checkOut, "medium"),
    });
    const guest = th("messagesPage.context.guestValue", {
      name: context.guestFirstName,
      count: context.guestCount,
    });
    contextRows.push([th("messagesPage.context.property"), context.propertyTitle]);
    if (context.roomName) contextRows.push([th("messagesPage.context.room"), context.roomName]);
    contextRows.push([th("messagesPage.context.dates"), dates]);
    contextRows.push([th("messagesPage.context.guest"), guest]);
    contextRows.push([th("messagesPage.context.status"), status]);
  }

  const renderMessage = (m: Msg) => {
    const mine = m.senderRole === myRole;
    const sender = mine ? t("you") : m.senderRole === "HOST" ? t("host") : t("guest");
    return (
      <li key={m.id} className={mine ? "text-right" : "text-left"}>
        {/* Gönderen yalnız hizalama/renkle değil, görünür etiketle de belirtilir. */}
        <p className="mb-0.5 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{sender}</span>
          {m.fromAiDraft && <span className="sr-only">{` (${t("fromAiDraft")})`}</span>}
          {" · "}
          <time dateTime={m.createdAt}>{f.time(m.createdAt)}</time>
        </p>
        {/* Geçmiş uyarılar kendiliğinden okunmaz; yeni gelen uyarı duyuru alanında okunur
            (yüksek risk acil). */}
        {!mine && m.risk && (
          <div
            className={`mb-1 max-w-[80%] rounded-md border px-3 py-2 text-left text-xs ${
              m.risk.level === "HIGH"
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            <p className="font-semibold">
              {m.risk.level === "HIGH" ? tt("message.highTitle") : tt("message.warnTitle")}
            </p>
            <p>{tt("message.advice")}</p>
            <p className="mt-1">
              {tt("message.reasonsLabel")} {riskReasons(m.risk.reasons)}
            </p>
          </div>
        )}
        {/* Satır sonları korunur; bölünmeyen uzun dizeler dar ekranda taşmaz. */}
        <div
          className={`inline-block max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-left text-sm [overflow-wrap:anywhere] ${
            mine ? "bg-[#003580] text-white" : "bg-gray-100 text-gray-900"
          }`}
        >
          {m.body}
        </div>
        {(m.maskedKinds.length > 0 || m.fromAiDraft) && (
          <div className="mt-0.5 text-xs text-gray-500">
            {m.maskedKinds.length > 0 && t("contactMasked")}
            {m.fromAiDraft && (
              <span
                data-ai-generated="true"
                aria-hidden="true"
                className="ml-1 inline-flex rounded-full bg-gray-200 px-2 py-0.5 font-medium text-gray-900"
              >
                {t("fromAiDraft")}
              </span>
            )}
          </div>
        )}
        {/* Gönderen, mesajının alıcıya uyarıyla gösterildiğini bilir (düzeltebilsin diye). */}
        {mine && m.risk && (
          <p className="ml-auto mt-0.5 max-w-[80%] text-xs text-gray-700">
            {t("riskSentNotice", { reasons: riskReasons(m.risk.reasons) })}
          </p>
        )}
      </li>
    );
  };

  return (
    <section aria-labelledby="msg-title" className={sectionClass}>
      <h2 id="msg-title" className="text-lg font-semibold text-gray-900">
        {t("title")}
      </h2>
      <p id="msg-safety" className="mt-1 text-xs text-gray-500">
        {t("safetyNotice")}
      </p>
      {contextRows.length > 0 && (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-gray-200 p-3 text-sm">
          {contextRows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-gray-700">{label}</dt>
              <dd className="min-w-0 break-words text-gray-900">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {/* Kaydırılabilir kap klavyeyle odaklanabilir (Safari kaydırıcıyı kendiliğinden odaklamaz).
          Liste kendiliğinden duyurulmaz; karşı taraftan yeni gelen mesaj aşağıdaki durum alanında
          kısaca okunur (kendi mesajınız ve geçmiş uyarılar tekrar okunmaz). */}
      <div
        ref={listRef}
        role="log"
        aria-labelledby="msg-title"
        aria-live="off"
        tabIndex={0}
        onScroll={onListScroll}
        className={`mt-4 max-h-80 space-y-4 overflow-y-auto rounded-md ${focusRing}`}
      >
        {olderHasMore && thread.messages.length > 0 && (
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="secondary"
              busy={loadingOlder}
              onClick={() => void loadOlder()}
              className="min-h-[44px] sm:min-h-0"
            >
              {loadingOlder ? t("loadingOlder") : t("loadOlder")}
            </Button>
            {olderFailed && (
              <p role="alert" className="text-sm text-red-600">
                {t("loadOlderFailed")}
              </p>
            )}
          </div>
        )}
        {thread.messages.length === 0 && <p className="text-sm text-gray-500">{t("empty")}</p>}
        {groupByDay(thread.messages).map((day) => (
          <div key={day.key}>
            <h3 className="mb-2 text-center text-xs font-semibold text-gray-700">
              <time dateTime={day.key}>{dayLabel(day)}</time>
            </h3>
            <ol className="space-y-2">{day.messages.map(renderMessage)}</ol>
          </div>
        ))}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <p role="alert" className="sr-only">
        {alertText}
      </p>
      <div className={liveState === "live" ? undefined : "mt-2 flex flex-wrap items-center gap-2"}>
        <p role="status" className="text-sm text-gray-700">
          {liveState === "reconnecting" && t("live.reconnecting")}
          {liveState === "stopped" && t("live.stopped")}
        </p>
        {liveState === "stopped" && (
          <Button variant="secondary" onClick={reconnect} className="min-h-[44px] sm:min-h-0">
            {t("live.reconnect")}
          </Button>
        )}
      </div>
      {needsLogin && loginPrompt}
      {thread.canWrite ? (
        <form onSubmit={send} className="mt-4 space-y-2">
          <label htmlFor="msg-body" className="block text-sm font-medium text-gray-900">
            {thread.role === "HOST" ? t("inputLabelToGuest") : t("inputLabelToHost")}
          </label>
          <textarea
            ref={inputRef}
            id="msg-body"
            rows={3}
            value={text}
            onChange={(e) => {
              updateText(e.target.value);
              // Taslak tamamen silinince mesaj artık taslaktan sayılmaz.
              if (!e.target.value.trim()) {
                setFromDraft(false);
                setDraftMode(null);
                setDraftLanguage(null);
              }
            }}
            aria-invalid={shownError || overLimit ? true : undefined}
            aria-describedby={describedBy}
            className="w-full rounded-lg border border-gray-500 p-2 text-base placeholder:text-gray-500 sm:text-sm"
            placeholder={t("placeholder")}
          />
          <p
            id="msg-count"
            className={`text-xs ${overLimit ? "font-semibold text-red-600" : "text-gray-500"}`}
          >
            {t("counter", { count: text.length, max: maxLength })}
          </p>
          {/* Her tuşta değil, yalnız eşik geçişinde duyurulur (metin durum başına sabit). */}
          <p aria-live="polite" className="sr-only">
            {overLimit
              ? t("counterOver", { max: maxLength })
              : nearLimit
                ? t("counterNear", { max: maxLength })
                : ""}
          </p>
          {pendingDraft && (
            <div
              ref={draftBoxRef}
              tabIndex={-1}
              role="group"
              aria-labelledby="msg-draft-title"
              aria-describedby="msg-draft-text msg-draft-notice"
              className={`rounded-lg border border-gray-300 p-3 ${focusRing}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p id="msg-draft-title" className="text-sm font-semibold text-gray-900">
                  {t("draftSuggestionTitle")}
                </p>
                <LlmBadge mode={pendingDraft.mode} audience="staff" />
              </div>
              <p id="msg-draft-text" className="mt-2 whitespace-pre-wrap text-sm text-gray-900">
                {pendingDraft.text}
              </p>
              <p id="msg-draft-notice" className="mt-1 text-xs text-amber-800">
                {t("aiDraftNotice")}
                {languageNote(pendingDraft.language)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => acceptDraft("replace")}
                  className="min-h-[44px] sm:min-h-0"
                >
                  {t("draftReplace")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => acceptDraft("append")}
                  className="min-h-[44px] sm:min-h-0"
                >
                  {t("draftAppend")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={dismissDraft}
                  className="min-h-[44px] sm:min-h-0"
                >
                  {t("draftDismiss")}
                </Button>
              </div>
            </div>
          )}
          <div role="status">
            {fromDraft && (
              <div className="flex flex-wrap items-center gap-2">
                <LlmBadge mode={draftMode} audience="staff" />
                <p id="msg-ai-notice" className="text-xs text-amber-800">
                  {t("aiDraftNotice")}
                  {languageNote(draftLanguage)}
                </p>
              </div>
            )}
          </div>
          {fromDraft && undoText !== null && (
            <Button variant="secondary" onClick={undoDraft} className="min-h-[44px] sm:min-h-0">
              {t("draftUndo")}
            </Button>
          )}
          <div aria-live="polite">
            {shownError && (
              <p id="msg-error" className="text-sm text-red-600">
                {shownError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              aria-disabled={sendDisabled || undefined}
              aria-busy={busy === "send" || undefined}
              className="min-h-[44px] rounded-lg bg-[#003580] px-4 py-2 text-sm font-semibold text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0"
            >
              {busy === "send" ? t("sending") : t("send")}
            </button>
            {thread.role === "HOST" && (
              <button
                type="button"
                onClick={() => void draft()}
                aria-disabled={busy !== null || undefined}
                aria-busy={busy === "draft" || undefined}
                className="min-h-[44px] rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 sm:min-h-0"
              >
                {busy === "draft" ? t("drafting") : t("suggestDraft")}
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="mt-4 text-sm text-gray-500">{t("closed")}</p>
      )}
    </section>
  );
}
