import Image from "next/image";

type StudioScrubzLogoProps = {
  size?: number;
  className?: string;
  decorative?: boolean;
  priority?: boolean;
};

export function StudioScrubzLogo({
  size = 96,
  className = "",
  decorative = false,
  priority = false,
}: StudioScrubzLogoProps) {
  return (
    <Image
      src="/branding/studioscrubz-logo.png"
      alt={decorative ? "" : "StudioScrubz"}
      width={500}
      height={500}
      priority={priority}
      sizes={`${size}px`}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
