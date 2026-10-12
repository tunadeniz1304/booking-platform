/**
 * Uzun rezervasyon numarası 5'li gruplar hâlinde okunur (telefonda/resepsiyonda söylemek için).
 * Gruplar arasında karakter yok: kopyalanan metin numaranın kendisidir.
 */
export default function BookingNumberText({
  id,
  className = "font-mono font-semibold",
}: {
  id: string;
  className?: string;
}) {
  const groups = id.match(/.{1,5}/g) ?? [id];
  return (
    <span translate="no" className={className}>
      {groups.map((group, i) => (
        <span key={i} className={i > 0 ? "ml-1" : undefined}>
          {group}
        </span>
      ))}
    </span>
  );
}
