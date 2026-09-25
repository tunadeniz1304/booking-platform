import { prisma } from "@/lib/prisma";
import type {
  BookingCancelledPayload,
  BookingConfirmedPayload,
  BookingExpiredPayload,
} from "@/lib/events/events";
import { sendEmail } from "./notifier";
import {
  bookingCancelledEmail,
  bookingConfirmedEmail,
  bookingExpiredEmail,
  emailLocale,
} from "./templates";

/** Olay → e-posta. Her olay tipi + rezervasyon için tek bildirim (dedupeKey). */

async function context(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      user: { select: { id: true, email: true, firstName: true, locale: true } },
      property: { select: { title: true, location: { select: { city: true } } } },
    },
  });
}

function info(
  ctx: NonNullable<Awaited<ReturnType<typeof context>>>,
  p: { checkIn: string; checkOut: string }
) {
  return {
    guestName: ctx.user.firstName,
    propertyTitle: ctx.property.title,
    city: ctx.property.location.city,
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    bookingId: ctx.id,
  };
}

export async function notifyBookingConfirmed(p: BookingConfirmedPayload) {
  const ctx = await context(p.bookingId);
  if (!ctx) return;
  return sendEmail({
    dedupeKey: `booking.confirmed:${p.bookingId}`,
    userId: ctx.user.id,
    to: ctx.user.email,
    content: bookingConfirmedEmail(
      {
        ...info(ctx, p),
        totalMinor: p.totalMinor,
        currency: p.currency,
      },
      emailLocale(ctx.user.locale)
    ),
  });
}

export async function notifyBookingCancelled(p: BookingCancelledPayload) {
  const ctx = await context(p.bookingId);
  if (!ctx) return;
  return sendEmail({
    dedupeKey: `booking.cancelled:${p.bookingId}`,
    userId: ctx.user.id,
    to: ctx.user.email,
    content: bookingCancelledEmail(
      {
        ...info(ctx, p),
        refundMinor: p.refundMinor ?? 0,
        currency: p.currency ?? "TRY",
      },
      emailLocale(ctx.user.locale)
    ),
  });
}

export async function notifyBookingExpired(p: BookingExpiredPayload) {
  const ctx = await context(p.bookingId);
  if (!ctx) return;
  return sendEmail({
    dedupeKey: `booking.expired:${p.bookingId}`,
    userId: ctx.user.id,
    to: ctx.user.email,
    content: bookingExpiredEmail(info(ctx, p), emailLocale(ctx.user.locale)),
  });
}
