/**
 * JetterLogo — inline SVG brand mark + wordmark.
 *
 * Glyph design: a stylized wave curl that resolves into a speed wake on the
 * right side. Two paths:
 *   1. The main wave arc — a rising, breaking swell that suggests motion and
 *      the Adriatic coast without being illustrative.
 *   2. The wake trail — two short horizontal strokes tapering right, reading
 *      as a jet ski cutting through water at speed.
 *
 * Both paths use currentColor so the parent controls the colour via a text-*
 * class. The SVG is intentionally monochrome — simpler, more confident.
 *
 * Server component — pure props → JSX. No state.
 */

type JetterLogoProps = {
  /** Class applied to the outer wrapper — controls size via text-* scale */
  className?: string;
};

export function JetterLogo({ className = '' }: JetterLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {/* Glyph — 28×22 viewBox, two-path wave + wake mark */}
      <svg
        width="28"
        height="22"
        viewBox="0 0 28 22"
        fill="none"
        role="img"
        aria-label="Jetter"
        focusable="false"
      >
        {/*
          Path 1: Wave arc — rises from left, peaks at centre-right, curls
          back with a small break-crest. Stroke-based for crispness at small
          sizes. strokeLinecap=round keeps it organic, not mechanical.
        */}
        <path
          d="M2 16 C5 16 7 6 12 6 C16 6 17 12 20 10 C22 8.5 23 7 25 7"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/*
          Path 2: Wake trail — two short lines below the wave, right-anchored,
          suggesting speed and the boat's track. The shorter second line reads
          as perspective taper.
        */}
        <path
          d="M18 14 L25 14 M20 17 L25 17"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>

      {/* Wordmark — Geist Sans, tight tracking, same weight as the brand feel.
          aria-hidden: the SVG carries aria-label="Jetter"; the text is a
          visual duplicate and would double-announce in screen readers. */}
      <span
        className="font-bold tracking-tight leading-none select-none text-brand-wordmark"
        aria-hidden="true"
      >
        Jetter
      </span>
    </span>
  );
}
