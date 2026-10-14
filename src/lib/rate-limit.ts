// Rate limiter ringan in-memory per instance — memakai globalThis supaya
// bertahan di antara pemanggilan dalam instance serverless yang sama.
// Batasan: tiap instance punya counter sendiri (tidak akurat lintas
// instance); untuk pembatasan ketat lintas instance pakai counter database.

const g = globalThis as unknown as { __ktdRateMap?: Map<string, number[]> };

/** IP klien — memakai header yang diisi Vercel (x-forwarded-for). */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Catat satu hit untuk `key`; kembalikan true bila jumlah hit dalam
 *  `windowMs` terakhir melebihi `max`. Key harus diberi namespace supaya
 *  tidak bentrok antar fitur (mis. "login:192.0.2.1"). */
export function rateLimitHit(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  const map = (g.__ktdRateMap ??= new Map<string, number[]>());
  const hits = (map.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  map.set(key, hits);
  // Bersihkan entri usang sesekali agar map tidak tumbuh tanpa batas.
  if (map.size > 1000) {
    for (const [k, v] of map) {
      if (v.every((t) => now - t >= windowMs)) map.delete(k);
    }
  }
  return hits.length > max;
}
