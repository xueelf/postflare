export function Logo({
  className,
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 128 128"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M112 16 L16 62.6014 L54.9594 73.0406 L65.3986 112 Z" />
      <path d="M32 16 A16 16 0 0 0 48 32 A16 16 0 0 0 32 48 A16 16 0 0 0 16 32 A16 16 0 0 0 32 16 Z" />
    </svg>
  );
}
