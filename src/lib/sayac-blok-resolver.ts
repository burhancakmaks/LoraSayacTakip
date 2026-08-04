import type { DatabaseSync } from "node:sqlite";

const VERIFIED_51ADA: Record<string, number> = {
  "A BLOK": 1723,
  "B BLOK": 1749,
  "C BLOK": 2016,
  OTOPARK: 2600,
};

const VERIFIED_SIRE: Record<string, number> = {
  "A BLOK": 1935,
  "B BLOK": 1938,
  "C BLOK": 1936,
  "D BLOK": 1937,
};

/** Doğrulanmış 4. ETAP ada|blok → bina_id eşleşmeleri */
export const VERIFIED_4ETAP: Record<string, number> = {
  "01|DB-01": 716, "01|DB-02": 717, "01|DB-03": 713, "01|DB-04": 718,
  "01|DB-05": 1939, "01|DB-06": 2646,
  "01|DC-01": 2642, "01|DC-02": 2642, "01|DC-03": 2614, "01|DC-04": 1763,
  "01|DC-05": 2629, "01|DC-06": 4690, "01|DC-07": 4690,
  "02|DB-07": 2676, "02|DB-08": 1907, "02|DB-09": 2755, "02|DB-10": 2776,
  "02|DB-11": 2689, "02|DB-12": 2673, "02|DC-08": 2669, "02|DC-09": 1127,
  "02|DC-10": 2764, "02|GB-01": 2628, "02|GB-02": 2000,
  "03|DB-13": 2675, "03|DB-14": 1764, "03|DB-15": 1764,
  "03|DC-11": 1940, "03|DC-12": 1940, "03|DC-13": 1654,
  "03|GB-03": 2601, "03|GB-04": 2601, "03|GB-05": 4674,
  "03|GB-06": 1942, "03|GB-07": 1942,
  "04|DB-16": 2767, "04|DB-17": 4692, "04|DB-18": 8, "04|DB-19": 300,
  "04|DB-20": 2777, "04|DB-21": 2602, "04|DC-14": 302, "04|DC-15": 1722,
  "04|DC-16": 1985, "04|DC-17": 2663, "04|DC-18": 2609, "04|DC-19": 1941,
  "05|DB-22": 1752, "05|DB-23": 716, "05|DC-20": 2001, "05|DC-21": 2610,
  "05|DC-22": 2631, "05|GB-08": 4669, "05|GB-09": 1103, "05|GB-10": 2002,
  "06|DB-24": 2772, "06|DB-25": 1998, "06|DB-26": 2685, "06|DB-27": 1999,
  "06|DB-28": 303, "06|DB-29": 2622, "06|DC-23": 1997, "06|DC-24": 4686,
  "06|DC-25": 1753, "06|DC-26": 2604, "06|DC-27": 4677,
  "06|GB-11": 1724, "06|GB-12": 2670, "06|GB-13": 4696, "06|GB-14": 623,
  "06|GB-15": 2606, "06|GB-16": 1714,
};

export function resolve4EtapBinaId(ada: string, blok: string): number | null {
  const adaKey = ada.padStart(2, "0");
  const blokKey = String(blok ?? "").trim().replace(/\*$/, "");
  return VERIFIED_4ETAP[`${adaKey}|${blokKey}`] ?? null;
}

export const SHEET_5ETAP: Record<string, number> = {
  GB1: 1788, GB2: 1787, GB3: 1790, GB4: 1804, GB5: 1075, GB6: 1800, GB7: 1795,
  DB1: 552, DB2: 58, DB3: 545, DB4: 59, DB5: 1064, DB6: 1071, DB7: 1065,
  DB8: 57, DB9: 1090, DB10: 47, DB11: 1098,
  DC1: 1265, DC2: 1268, DC3: 558, DC4: 1271, DC5: 1193, DC6: 1263,
  DC7: 1070, DC8: 1094, DC9: 159, DC10: 1079,
  DC11: 1099, DC12: 1068, DC13: 1100, DC14: 1066, DC15: 1089,
};

const BLOCK_TARGETS: Record<string, Record<string, number[]>> = {
  "49 ADA": {
    "A BLOK": [1945], "B BLOK": [1751, 1946], "C BLOK": [1750, 1947], "D BLOK": [1724, 1948],
    "E BLOK": [1753, 1949], "F BLOK": [1752, 1950], "G BLOK": [1951], "H BLOK": [1952],
    "I BLOK": [2001], "J BLOK": [2002], "K BLOK": [2003], "L BLOK": [2004], "M BLOK": [2005],
  },
  "37-50 A-B": { A: [1722, 1954], B: [1732, 1955] },
  "37-50 E": { "E BLOK": [1736, 1910] },
  "46 ADA": { _all: [1939] },
  SIRE: { _all: [1937] },
};

const ADA_PARSEL_MAP: Record<string, string> = {
  "49": "49",
  "49 ADA": "49",
  "37-50": "37-50",
  "37-50 A-B": "37-50",
  "37-50 E": "37-50",
  "46": "46",
  "46 ADA": "46",
  "51": "51",
  "51 ADA": "51",
  "53": "53",
  "53 ADA": "53",
  "41-134": "41-134",
  "ŞİRE": "ŞİRE",
  "SIRE": "ŞİRE",
  "5. ETAP": "5. ETAP",
  "5 ETAP": "5. ETAP",
  "4. ETAP": "4. ETAP",
  "4 ETAP": "4. ETAP",
};

export function normBlok(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function normalizeAdaParsel(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return ADA_PARSEL_MAP[s.toUpperCase()] ?? ADA_PARSEL_MAP[s] ?? s;
}

export function buildBlokResolver(db: DatabaseSync): (adaParsel: string, blok: string) => number | null {
  const map = new Map<string, { binaId: number; score: number }>();

  for (const [blok, binaId] of Object.entries(VERIFIED_51ADA)) {
    map.set(`51|${normBlok(blok)}`, { binaId, score: 20000 });
  }
  for (const [blok, binaId] of Object.entries(VERIFIED_SIRE)) {
    map.set(`ŞİRE|${normBlok(blok)}`, { binaId, score: 20000 });
  }

  for (const r of db
    .prepare(
      `SELECT bb.ada_parsel, s.blok_no, s.bina_id,
        (SELECT COUNT(*) FROM bina_bilgi bi WHERE bi.bina_id = s.bina_id) AS configured,
        COUNT(*) AS cnt
      FROM sayac s
      JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
      WHERE bb.ada_parsel IS NOT NULL AND TRIM(bb.ada_parsel) != ''
      GROUP BY bb.ada_parsel, s.blok_no, s.bina_id`
    )
    .all() as { ada_parsel: string; blok_no: string; bina_id: number; configured: number; cnt: number }[]) {
    const key = `${r.ada_parsel}|${normBlok(r.blok_no)}`;
    const score = (r.configured ? 1000 : 0) + r.cnt;
    const prev = map.get(key);
    if (!prev || score > prev.score) map.set(key, { binaId: r.bina_id, score });
  }

  for (const [adaKey, blocks] of Object.entries(BLOCK_TARGETS)) {
    const adaParsel = ADA_PARSEL_MAP[adaKey] ?? adaKey;
    for (const [blok, ids] of Object.entries(blocks)) {
      if (blok === "_all") continue;
      const key = `${adaParsel}|${normBlok(blok)}`;
      if (!map.has(key) && ids.length) map.set(key, { binaId: ids[0], score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE '46 ADA%'`).all() as { id: number; value: string }[]) {
    const m = String(r.value).match(/46 ADA\s+(.+)/i);
    if (m) {
      const key = `46|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE '53 ADA%'`).all() as { id: number; value: string }[]) {
    const m = String(r.value).match(/53 ADA\s+(.+)/i);
    if (m) {
      const key = `53|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE '51 ADA%'`).all() as { id: number; value: string }[]) {
    const m = String(r.value).match(/51 ADA\s+(.+)/i);
    if (m) {
      const key = `51|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db.prepare(`SELECT id, value FROM binalar WHERE value LIKE 'ŞİRE%'`).all() as { id: number; value: string }[]) {
    const m = String(r.value).match(/ŞİRE\s+(.+)/i);
    if (m) {
      const key = `ŞİRE|${normBlok(m[1])}`;
      if (!map.has(key)) map.set(key, { binaId: r.id, score: 0 });
    }
  }

  for (const r of db
    .prepare(
      `SELECT s.bina_id, s.blok_no FROM sayac s
       JOIN bina_bilgi bb ON bb.bina_id = s.bina_id
       WHERE bb.ada_parsel = '41-134'
       GROUP BY s.bina_id, s.blok_no`
    )
    .all() as { bina_id: number; blok_no: string }[]) {
    const key = `41-134|${normBlok(r.blok_no)}`;
    if (!map.has(key)) map.set(key, { binaId: r.bina_id, score: 0 });
  }

  return (adaParsel: string, blok: string) => {
    const b = normBlok(blok);

    if (adaParsel === "5. ETAP" || adaParsel === "5 ETAP") {
      const etapId = SHEET_5ETAP[b.replace(/\s+BLOK$/i, "")];
      if (etapId) return etapId;
    }

    const keys = [`${adaParsel}|${b}`];
    if (!/BLOK$/i.test(b)) keys.push(`${adaParsel}|${b} BLOK`);
    const short = b.replace(/\s+BLOK$/i, "");
    if (short !== b) keys.push(`${adaParsel}|${short}`);
    for (const key of keys) {
      const hit = map.get(key);
      if (hit) return hit.binaId;
    }
    return null;
  };
}

export function resolveBinaId(
  resolve: (adaParsel: string, blok: string) => number | null,
  adaParsel: string,
  blok: string
): number | null {
  const ada = normalizeAdaParsel(adaParsel);
  const b = normBlok(blok);
  const etapCode = b.replace(/\s+BLOK$/i, "");

  // 5. ETAP blok kodları (GB1, DC8, DB1...) ADA olmadan da tanınır
  if (SHEET_5ETAP[etapCode]) return SHEET_5ETAP[etapCode];

  if (ada) {
    const direct = resolve(ada, b);
    if (direct) return direct;
  }

  const fallbacks = ["5. ETAP", "49", "37-50", "46", "51", "53", "41-134", "ŞİRE"];
  for (const f of fallbacks) {
    const hit = resolve(f, b);
    if (hit) return hit;
  }

  return resolve(ada || "49", b);
}
