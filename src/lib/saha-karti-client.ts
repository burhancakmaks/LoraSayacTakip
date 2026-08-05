export type SahaKartiFormat = "pdf" | "xlsx";

export interface SahaKartiDownloadOptions {
  binaId: number;
  format: SahaKartiFormat;
  aboneNo?: string;
  sayacId?: string;
}

export async function downloadSahaKarti({
  binaId,
  format,
  aboneNo,
  sayacId,
}: SahaKartiDownloadOptions): Promise<void> {
  const params = new URLSearchParams({
    bina_id: String(binaId),
    format,
  });
  if (aboneNo?.trim()) params.set("abone_no", aboneNo.trim());
  if (sayacId?.trim()) params.set("sayac_id", sayacId.trim());

  const response = await fetch(`/api/saha-karti?${params.toString()}`);
  if (!response.ok) {
    let message = "Saha kartı indirilemedi";
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore json parse errors
    }
    throw new Error(message);
  }

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const filename = match?.[1] || `saha-karti-${binaId}.${format}`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
