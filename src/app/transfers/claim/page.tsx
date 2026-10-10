"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import ClaimForm, { stashClaimToken } from "@/components/transfers/ClaimForm";
import { PageShell, RoleGate, focusRing, loginHref, useSession } from "@/components/ui/ui";

const linkClass = `font-semibold text-[#003580] underline ${focusRing}`;

/** Devir linkini açan alıcı: kart istemcide token'lanır, POST /api/transfers/claim. */
export default function ClaimPage() {
  const t = useTranslations("transfers");
  const session = useSession();
  const signedOut = session.status === "ready" && !session.user;

  // Giriş/kayıt dönüşünde token kaybolmasın: hash'teki token sekme oturumunda saklanır,
  // yönlendirme adresine yalnızca yol yazılır (token query string'e girmez).
  useEffect(() => {
    if (signedOut) stashClaimToken();
  }, [signedOut]);

  return (
    <PageShell title={t("claim.title")} intro={t("claim.intro")}>
      {signedOut ? (
        <p className="text-sm text-gray-800">
          {t.rich("claim.loginPrompt", {
            login: (chunks) => (
              <Link href={loginHref("/transfers/claim")} className={linkClass}>
                {chunks}
              </Link>
            ),
            register: (chunks) => (
              <Link href={loginHref("/transfers/claim", "/register")} className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : (
        <RoleGate>{() => <ClaimForm />}</RoleGate>
      )}
    </PageShell>
  );
}
