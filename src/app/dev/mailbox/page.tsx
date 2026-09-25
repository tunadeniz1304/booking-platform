import { notFound } from "next/navigation";
import { isDemoMode } from "@/lib/config/demo";
import MailboxClient from "@/components/dev/MailboxClient";

/** Geliştirme posta kutusu — yalnızca demo modunda (production'da 404, v3#11). */
export default function MailboxPage() {
  if (!isDemoMode()) notFound();
  return <MailboxClient />;
}

export const dynamic = "force-dynamic";
