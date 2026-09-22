/**
 * BOLA (Broken Object Level Authorization) denetim yardımcıları.
 *
 * Her kaynak-yönlü okuma/yazma işlemi sahiplik doğrulamasından geçer:
 * sırf nesnenin id'sini bilerek başkasının kaynağına erişilemez.
 */

export class OwnershipError extends Error {
  constructor(message = "Bu kaynağa erişim yetkiniz yok") {
    super(message);
    this.name = "OwnershipError";
  }
}

/** Kaynak sahibi ile istekçi aynı değilse `errorFactory()` hatasını fırlatır. */
export function requireOwnership(
  resourceOwnerId: string | undefined | null,
  requesterId: string | undefined | null,
  errorFactory: () => Error = () => new OwnershipError()
): void {
  if (!resourceOwnerId || !requesterId || resourceOwnerId !== requesterId) {
    throw errorFactory();
  }
}

/** Kaynak var ve sahibi istekçi mi? (false → güvenli erişim değil) */
export function isOwnedBy(
  resourceOwnerId: string | undefined | null,
  requesterId: string | undefined | null
): boolean {
  return Boolean(resourceOwnerId && requesterId && resourceOwnerId === requesterId);
}
