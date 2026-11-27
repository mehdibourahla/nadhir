export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={256}
      height={256}
      decoding="async"
      className={className}
    />
  );
}
