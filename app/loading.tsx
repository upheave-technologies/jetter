// Skeleton shown by Next.js while the Board page data fetches.
// Mirrors the reservation-pivot layout: header, day-nav, tab bar, raspored tab skeleton.
// Server component — no 'use client' needed for skeleton content.

export default function Loading() {
  return (
    <div className="flex flex-col min-h-dvh bg-background">
      {/* Header skeleton — mirrors AvailabilityHeader */}
      <div className="sticky top-0 z-20 border-b border-border bg-card shadow-card-md">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          {/* Brand lockup skeleton */}
          <div className="flex items-center gap-2">
            <div className="h-6 w-7 rounded animate-pulse bg-muted" />
            <div className="h-5 w-14 rounded animate-pulse bg-muted" />
          </div>
          {/* Free-now hero skeleton */}
          <div className="flex items-baseline gap-2 rounded-xl px-3 py-1.5 bg-muted/40">
            <div className="h-10 w-10 rounded animate-pulse bg-muted" />
            <div className="h-7 w-6 rounded animate-pulse bg-muted" />
            <div className="h-6 w-16 rounded animate-pulse bg-muted" />
          </div>
          {/* Clock skeleton */}
          <div className="h-5 w-12 rounded animate-pulse bg-muted" />
        </div>
        <div className="h-5 bg-muted/20" />
      </div>

      {/* Day nav skeleton */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-card border-b border-border">
        <div className="h-10 w-20 rounded-xl animate-pulse bg-muted" />
        <div className="flex flex-col items-center gap-1">
          <div className="h-5 w-24 rounded animate-pulse bg-muted" />
          <div className="h-4 w-20 rounded animate-pulse bg-muted" />
        </div>
        <div className="h-10 w-20 rounded-xl animate-pulse bg-muted" />
      </div>

      {/* Tab bar skeleton */}
      <div className="bg-card border-b border-border flex">
        <div className="flex-1 py-3 flex items-center justify-center">
          <div className="h-5 w-24 rounded-lg animate-pulse bg-muted" />
        </div>
        <div className="flex-1 py-3 flex items-center justify-center">
          <div className="h-5 w-24 rounded-lg animate-pulse bg-muted" />
        </div>
      </div>

      {/* Main content skeleton — tab A (raspored) */}
      <main className="flex-1 px-4 py-4 pb-10 max-w-xl mx-auto w-full flex flex-col gap-4">
        {/* Create form skeleton — primary card */}
        <div className="rounded-2xl bg-card border border-border p-5 shadow-card-md">
          <div className="h-5 w-36 rounded animate-pulse bg-muted mb-5" />
          {/* Quantity grid */}
          <div className="grid grid-cols-8 gap-1.5 mb-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <div key={n} className="h-10 rounded-lg animate-pulse bg-muted" />
            ))}
          </div>
          {/* Duration presets */}
          <div className="flex gap-1.5 mb-5">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-9 w-16 rounded-lg animate-pulse bg-muted" />
            ))}
          </div>
          {/* First slot hero skeleton */}
          <div className="rounded-xl border border-border bg-muted/20 p-3 mb-5">
            <div className="h-3 w-32 rounded mb-2 animate-pulse bg-muted" />
            <div className="h-14 rounded-xl animate-pulse bg-muted" />
          </div>
          {/* CTA skeleton */}
          <div className="h-14 rounded-xl animate-pulse bg-muted" />
        </div>

        {/* Reservation list skeletons */}
        <div>
          <div className="h-3 w-24 rounded mb-3 animate-pulse bg-muted" />
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="booking-card animate-pulse">
                <div className="p-4">
                  <div className="flex justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-baseline gap-2">
                        <div className="h-7 w-8 rounded bg-muted" />
                        <div className="h-4 w-12 rounded bg-muted" />
                        <div className="h-6 w-24 rounded bg-muted" />
                      </div>
                      <div className="h-4 w-20 rounded bg-muted" />
                    </div>
                    <div className="h-6 w-20 rounded-full bg-muted" />
                  </div>
                </div>
                <div className="flex gap-2 px-4 pb-4">
                  <div className="h-11 w-16 rounded-xl bg-muted" />
                  <div className="h-11 w-16 rounded-xl bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
