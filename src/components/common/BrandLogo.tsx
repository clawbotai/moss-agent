type BrandLogoProps = {
  size?: number;
  className?: string;
  title?: string;
  decorative?: boolean;
};

export function BrandLogo({
  size = 32,
  className,
  title = "Moss Agent",
  decorative = false,
}: BrandLogoProps) {
  const ariaProps = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": title };

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...ariaProps}
    >
      {!decorative && <title>{title}</title>}
      <defs>
        <linearGradient id="mossLogoBg" x1="9" y1="7" x2="58" y2="59" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8B7CF8" />
          <stop offset="0.52" stopColor="#6366F1" />
          <stop offset="1" stopColor="#312E81" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#mossLogoBg)" />
      <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="13.25" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1.5" />
      <path d="M17.5 44.5V20.5L32 34L46.5 20.5V44.5" stroke="#F4FFFB" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 20.5L32 34L46.5 20.5" stroke="#DDE0FF" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.78" />
      <circle cx="46.5" cy="20.5" r="3" fill="#F4FFFB" />
    </svg>
  );
}
