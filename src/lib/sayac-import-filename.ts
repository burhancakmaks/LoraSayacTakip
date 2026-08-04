function basename(pathOrName: string): string {
  return pathOrName.split(/[/\\]/).pop() ?? pathOrName;
}

/** pending-{uuid}-{orijinal-ad} dosya adından orijinal Excel adını çıkarır */
export function extractPendingUploadFilename(uploadPathOrName: string): string {
  const base = basename(uploadPathOrName);
  const full = base.match(/^pending-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i);
  if (full) return full[1];
  return base;
}

/** Geçmiş kayıtlarındaki kırpılmış UUID öneklerini temizleyerek gösterim adı üretir */
export function formatImportDisplayName(filename: string): string {
  const cleaned = filename.replace(/\s+/g, " ").trim();
  const fromPending = extractPendingUploadFilename(cleaned);
  if (fromPending !== cleaned) return fromPending;

  const withoutFullUuid = cleaned.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    ""
  );
  if (withoutFullUuid !== cleaned) return withoutFullUuid;

  const withoutPartialUuid = cleaned.replace(
    /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    ""
  );
  return withoutPartialUuid || cleaned;
}
