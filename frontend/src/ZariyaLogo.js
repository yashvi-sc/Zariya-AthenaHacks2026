import React from 'react';

/**
 * Simple “Z” mark: black tile, rose–red gradient letter (matches app accents).
 */
export default function ZariyaLogo({
  size = 36,
  className = '',
  title = 'Zariya',
  'aria-hidden': ariaHidden,
  ...rest
}) {
  const s = size;
  const hidden = Boolean(ariaHidden);
  return (
    <div
      className={`inline-flex items-center justify-center rounded-lg border border-rose-500/45 bg-black shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] ${className}`}
      style={{ width: s, height: s, minWidth: s, minHeight: s }}
      role={hidden ? undefined : 'img'}
      aria-label={hidden ? undefined : title}
      aria-hidden={ariaHidden}
      {...rest}
    >
      <span
        className="select-none font-display font-bold leading-none text-transparent bg-clip-text bg-gradient-to-br from-rose-400 via-rose-500 to-red-600"
        style={{ fontSize: Math.max(12, Math.round(s * 0.52)) }}
        aria-hidden
      >
        Z
      </span>
    </div>
  );
}
