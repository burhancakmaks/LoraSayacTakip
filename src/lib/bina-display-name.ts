/** Bina görünen adı: KML value yoksa blok / ada_parsel kullan */
export function resolveBinaDisplayName(
  value: string | null | undefined,
  options?: { blokNo?: string | null; adaParsel?: string | null; binaId?: number | null }
): string {
  const v = String(value ?? "").trim();
  if (v) return v;

  const blok = String(options?.blokNo ?? "").trim();
  if (blok) {
    const ada = String(options?.adaParsel ?? "").trim();
    return ada ? `${ada} ${blok}` : blok;
  }

  if (options?.binaId) return `Bina #${options.binaId}`;
  return "Bilinmeyen Bina";
}
