"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/lib/api-client";
import { TEST_CARDS, parseMockToken } from "@/lib/payment/card-token";
import { newIdempotencyKey } from "@/lib/ui/format";
import { useFormat } from "@/i18n/use-format";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import {
  CardFields,
  tokenizeCardFields,
  type CardField,
  type CardFieldErrors,
  type CardValues,
} from "@/components/payment/CardFields";
import {
  Button,
  Card,
  Status,
  focusFirstInvalid,
  focusRing,
  useErrorText,
} from "@/components/ui/ui";

/** Giriş/kayıt sırasında devir token'ı kaybolmasın diye sekme oturumunda saklanır. */
const CLAIM_TOKEN_KEY = "transfer-claim-token";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function hashToken(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token") ?? "";
}

/** Oturumsuz alıcı giriş yapmaya giderken token'ı sakla (query string'e konmaz). */
export function stashClaimToken(): void {
  const token = hashToken();
  if (!token) return;
  try {
    window.sessionStorage.setItem(CLAIM_TOKEN_KEY, token);
  } catch {
    /* depolama kapalıysa bağlantı yeniden açılmalı */
  }
}

function clearStashedToken(): void {
  try {
    window.sessionStorage.removeItem(CLAIM_TOKEN_KEY);
  } catch {
    /* yok say */
  }
}

/** Token URL parçasında (#token=…) taşınır: sunucu loglarına/Referer'a gitmez. */
function readToken(): string {
  const fromHash = hashToken();
  if (fromHash) return fromHash;
  try {
    return window.sessionStorage.getItem(CLAIM_TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

type ResendState = "idle" | "sending" | "sent" | "verified" | "failed";

/** E-posta doğrulanmamışsa devir yapılamaz: açıklama + doğrulama e-postasını yeniden gönder. */
export function VerifyEmailNotice() {
  const t = useTranslations("transfers.verify");
  const [state, setState] = useState<ResendState>("idle");

  async function resend() {
    if (state === "sending") return;
    setState("sending");
    try {
      const res = await apiFetch<{ sent?: boolean; alreadyVerified?: boolean }>(
        "/api/auth/verify-email/resend",
        { method: "POST", body: "{}" }
      );
      setState(res.alreadyVerified ? "verified" : "sent");
    } catch {
      setState("failed");
    }
  }

  const statusText =
    state === "sent"
      ? t("sent")
      : state === "verified"
        ? t("alreadyVerified")
        : state === "failed"
          ? t("failed")
          : "";

  return (
    <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3 text-sm text-gray-900">
      <p className="font-semibold">{t("title")}</p>
      <p className="mt-1">{t("body")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={resend}
          disabled={state === "sending"}
          aria-busy={state === "sending"}
        >
          {state === "sending" ? t("sending") : t("resend")}
        </Button>
        <span aria-live="polite">{statusText}</span>
      </div>
    </div>
  );
}

export function isEmailNotVerified(err: unknown): boolean {
  return err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED";
}

const linkClass = `font-semibold text-[#003580] underline ${focusRing}`;

/** Kart formu yerine gösterilir: bağlantı geçersiz, süresi dolmuş, alınmış ya da kendi ilanı. */
type ClaimBlock = "invalid" | "expired" | "gone" | "self";

/**
 * Token gövdesindeki bitiş zamanı; biçim bozuksa null. İmza burada doğrulanmaz (sunucu
 * doğrular): yalnızca süresi dolmuş bağlantıyı kart bilgisi girilmeden bildirmek için.
 */
function tokenExpiry(token: string): number | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const json = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** Dakikaya yuvarlanmış saat: snapshot render'lar arasında kararlı kalır. */
const minuteNow = () => Math.floor(Date.now() / 60_000) * 60_000;

export default function ClaimForm({ emailVerified }: { emailVerified?: boolean }) {
  const t = useTranslations("transfers.claim");
  const tp = useTranslations("payment");
  const tNav = useTranslations("nav");
  const tTitles = useTranslations("titles");
  const errorText = useErrorText();
  const f = useFormat();
  const { confirm, confirmDialog } = useConfirm();
  const token = useSyncExternalStore(subscribe, readToken, () => "");
  const nowMs = useSyncExternalStore(subscribe, minuteNow, () => 0);
  const [card, setCard] = useState<CardValues>({ number: "", exp: "", cvc: "" });
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerify, setNeedsVerify] = useState(emailVerified === false);
  const [maybeCharged, setMaybeCharged] = useState(false);
  const [done, setDone] = useState<{ bookingId: string; paid: string } | null>(null);
  const [serverBlock, setServerBlock] = useState<ClaimBlock | null>(null);
  // Aynı kartla yeniden deneme aynı anahtarı taşır: yanıt kaybolsa da çift tahsilat olmaz.
  const idempotencyKey = useRef<string>("");
  const attempted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const blockRef = useRef<HTMLParagraphElement>(null);
  const exp = token ? tokenExpiry(token) : null;

  // Başarıda form DOM'dan kalkar: odak sonuç başlığına taşınır.
  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  // Gönderimden sonra bağlantı kullanılamaz çıktıysa odak açıklamaya taşınır.
  useEffect(() => {
    if (serverBlock) blockRef.current?.focus();
  }, [serverBlock]);

  function updateCard(field: CardField, value: string) {
    if (field === "number" && value !== card.number) idempotencyKey.current = "";
    setCard((c) => ({ ...c, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((errs) => ({ ...errs, [field]: undefined }));
  }

  function failField(field: CardField, text: string) {
    setFieldErrors({ [field]: text });
    focusFirstInvalid(formRef.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNeedsVerify(false);
    const r = tokenizeCardFields(card);
    if (!r.ok) {
      if (r.field) {
        failField(r.field, tp(r.messageKey));
      } else {
        setFieldErrors({});
        setError(t("invalidCard"));
        document.getElementById("card-number")?.focus();
      }
      return;
    }
    // Devirde etkileşimli 3DS adımı yok: sunucu bu kartı reddeder ve deneme hakkı yanar.
    if (parseMockToken(r.cardToken)?.scenario === "3ds") {
      failField("number", t("threeDsUnsupported"));
      return;
    }
    setFieldErrors({});
    if (
      !(await confirm({
        title: t("confirmTitle"),
        body: t("confirmBody"),
        confirmLabel: t("confirmAction"),
        tone: "primary",
      }))
    ) {
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = newIdempotencyKey();
    setBusy(true);
    try {
      const res = await apiFetch<{ bookingId: string; paidMinor: number; currency: string }>(
        "/api/transfers/claim",
        {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey.current },
          body: JSON.stringify({ token, cardToken: r.cardToken }),
        }
      );
      clearStashedToken();
      setMaybeCharged(false);
      setDone({ bookingId: res.bookingId, paid: f.money(res.paidMinor, res.currency) });
      // Başarılı devirden sonra token'ı adres çubuğundan kaldır.
      window.history.replaceState(null, "", window.location.pathname);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (isEmailNotVerified(err)) {
        setNeedsVerify(true);
      } else if (err instanceof ApiError && err.status === 409 && attempted.current) {
        // Önceki deneme sunucuya ulaşmış olabilir: ödeme alınmış ve devir tamamlanmış olabilir.
        setMaybeCharged(true);
      } else if (code === "INVALID_TOKEN" || code === "ALREADY_CLAIMED" || code === "SELF_CLAIM") {
        // Bağlantı kullanılamaz: kart formu yerine nedeni ve sonraki adımlar gösterilir.
        clearStashedToken();
        setServerBlock(
          code === "SELF_CLAIM"
            ? "self"
            : code === "ALREADY_CLAIMED"
              ? "gone"
              : exp !== null && exp < Date.now()
                ? "expired"
                : "invalid"
        );
        return;
      }
      setError(errorText(err));
    } finally {
      attempted.current = true;
      setBusy(false);
    }
  }

  const linkBlock: ClaimBlock | null =
    !token || exp === null ? "invalid" : nowMs > 0 && exp < nowMs ? "expired" : null;
  const block = serverBlock ?? (done ? null : linkBlock);

  if (block) {
    const text =
      block === "expired"
        ? t("linkExpired", { date: exp === null ? "" : f.dateTime(new Date(exp)) })
        : block === "gone"
          ? t("linkGone")
          : block === "self"
            ? t("selfClaim")
            : t("invalidLink");
    return (
      <div className="space-y-2 text-sm">
        <p ref={blockRef} tabIndex={-1} className={`rounded-sm text-red-700 ${focusRing}`}>
          {text}
        </p>
        {(block === "invalid" || block === "gone") && (
          <p className="text-gray-800">{t("invalidLinkHelp")}</p>
        )}
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li>
            <Link href="/transfers" className={linkClass}>
              {tNav("transfers")}
            </Link>
          </li>
          <li>
            <Link href="/trips" className={linkClass}>
              {tTitles("trips")}
            </Link>
          </li>
        </ul>
      </div>
    );
  }

  return (
    <Card title={t("paymentTitle")} id="claim">
      {done ? (
        <div className="space-y-1 text-sm text-gray-900">
          <h3
            ref={successRef}
            tabIndex={-1}
            className={`rounded-sm text-base font-semibold ${focusRing}`}
          >
            {t("done", { amount: done.paid })}
          </h3>
          <p>
            {t.rich("owned", {
              link: (chunks) => (
                <Link href={`/booking/${done.bookingId}`} className={linkClass}>
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
      ) : (
        <form ref={formRef} onSubmit={submit} aria-busy={busy} className="space-y-3">
          <p className="text-sm text-gray-800">{t("reviewNote")}</p>
          <CardFields
            idPrefix="card"
            values={card}
            onChange={updateCard}
            errors={fieldErrors}
            disabled={busy}
            numberHint={t("cardHint", { success: TEST_CARDS.success, decline: TEST_CARDS.decline })}
          />
          <Button type="submit" busy={busy}>
            {busy ? t("processing") : t("submit")}
          </Button>
        </form>
      )}
      <div className="mt-3">
        <Status error={error} />
      </div>
      {needsVerify && <VerifyEmailNotice />}
      {maybeCharged && (
        <p className="mt-3 text-sm text-gray-900">
          {t.rich("maybeCharged", {
            link: (chunks) => (
              <Link href="/trips" className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      {confirmDialog}
    </Card>
  );
}
