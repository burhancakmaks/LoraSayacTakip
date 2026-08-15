import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import {
  asIdentityString,
  normalizeMeterNumber,
  parseWktPoint,
  meterDigits,
  REASON,
} from "./common.mjs";
import { projectPoint } from "./crs.mjs";
import { parseCsvDevices, readCoordinateWorkbook, detectExcelSchema, EXCEL_SCHEMA } from "./parsers.mjs";
import { matchPointToBuildings, resolveOverlayHits, BOUNDARY_EPS_M } from "./spatial.mjs";
import { ensureMeterCoordTables } from "./schema.mjs";
import { applyPlan, createDbBackup } from "./apply.mjs";
import { MARKA_FROM_VALUE, resolveMarka } from "./plan.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

function tmp() {
  return mkdtempSync(join(tmpdir(), "meter-coord-"));
}

test("BOM and blank-line CSV parse keeps DevEUI leading zeros", () => {
  const dir = tmp();
  const path = join(dir, "d.csv");
  writeFileSync(
    path,
    "\n\uFEFFBölge;Blok;Daire;Kat;DevEUI;Durum;Son Uplink;Kaydeden;Kayıt Tarihi;Notlar\nİKİZCE;A1;Daire 1;0;000019c640010392;active;;Can;2026-07-23;\n",
    "utf8"
  );
  const parsed = parseCsvDevices(path);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].deveui, "000019c640010392");
  assert.equal(parsed.rows[0].bolge, "İKİZCE");
  rmSync(dir, { recursive: true, force: true });
});

test("POINT WKT parses; invalid WKT rejected", () => {
  const ok = parseWktPoint("POINT (442109.200110961 4247790.01080629)");
  assert.equal(ok.x, 442109.200110961);
  assert.equal(ok.y, 4247790.01080629);
  assert.equal(parseWktPoint("POINT (foo bar)"), null);
  assert.equal(parseWktPoint(""), null);
  assert.equal(parseWktPoint("POINT (1)"), null);
});

test("1435754.0 normalizes to 1435754; scientific rejected", () => {
  assert.equal(normalizeMeterNumber(1435754.0).normalized, "1435754");
  assert.equal(normalizeMeterNumber("1435754.0").normalized, "1435754");
  assert.equal(asIdentityString("1.23e10"), null);
  assert.equal(normalizeMeterNumber("").ok, false);
});

test("leading zeros in meter numbers are kept", () => {
  assert.equal(normalizeMeterNumber("03004541").normalized, "03004541");
});

test("2025- prefix digit normalization matches project rule", () => {
  assert.equal(meterDigits("2025-01428614"), "01428614");
});

test("EPSG:5258 conversion lands in Malatya", () => {
  const wgs = projectPoint(442109.200110961, 4247790.01080629, "EPSG:5258");
  assert.ok(wgs.lat > 38.3 && wgs.lat < 38.4);
  assert.ok(wgs.lng > 38.2 && wgs.lng < 38.4);
});

test("EPSG:5258 eastern Battalgazi point is near lng 38.66", () => {
  const wgs = projectPoint(470369.3662, 4246557.9417, "EPSG:5258");
  assert.ok(wgs.lat > 38.34 && wgs.lat < 38.36);
  assert.ok(wgs.lng > 38.65 && wgs.lng < 38.67);
});

function squareBuilding(id, value, lat, lng, half = 0.0002, extra = {}) {
  const rings = [[
    [lat - half, lng - half],
    [lat - half, lng + half],
    [lat + half, lng + half],
    [lat + half, lng - half],
    [lat - half, lng - half],
  ]];
  return {
    id,
    value,
    layer: extra.layer || "P_KONUT_MULTIPOLYGON",
    skipLayer: false,
    rings,
    bbox: { minLat: lat - half, maxLat: lat + half, minLng: lng - half, maxLng: lng + half },
    sayacCount: extra.sayacCount || 0,
    hasBilgi: extra.hasBilgi || false,
  };
}

function indexOf(...buildings) {
  const grid = new Map();
  const CELL = 0.0008;
  for (const b of buildings) {
    const i = Math.floor(b.bbox.minLat / CELL);
    const j = Math.floor(b.bbox.minLng / CELL);
    const key = `${i}_${j}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(b);
  }
  return { buildings, grid, searchable: buildings };
}

test("same-coordinate meters bind to the same building", () => {
  const b = squareBuilding(10, "A1", 38.36, 38.33);
  const idx = indexOf(b);
  const m1 = matchPointToBuildings(idx, 38.36, 38.33, 0, BOUNDARY_EPS_M);
  const m2 = matchPointToBuildings(idx, 38.36, 38.33, 0, BOUNDARY_EPS_M);
  assert.equal(m1.building.id, 10);
  assert.equal(m2.building.id, 10);
  assert.equal(m1.method, "inside");
});

test("nearest beyond threshold is skipped; equal candidates stay ambiguous", () => {
  const a = squareBuilding(1, "A", 38.36, 38.33);
  const b = squareBuilding(2, "B", 38.3615, 38.33);
  const idx = indexOf(a, b);
  const far = matchPointToBuildings(idx, 38.38, 38.35, 0.5, BOUNDARY_EPS_M);
  assert.equal(far.building, null);

  const left = squareBuilding(3, "L", 38.36, 38.3295);
  const right = squareBuilding(4, "R", 38.36, 38.3305);
  const idx2 = indexOf(left, right);
  const mid = matchPointToBuildings(idx2, 38.36, 38.33, 80, BOUNDARY_EPS_M);
  assert.equal(mid.reason, REASON.AMBIGUOUS_BUILDING);
});

test("same-name overlay resolves to primary layer; different names do not", () => {
  const primary = squareBuilding(1, "A4", 38.36, 38.33, 0.0002, {
    layer: "P_KONUT_MULTIPOLYGON",
    hasBilgi: true,
  });
  const copy = squareBuilding(2, "A4", 38.36, 38.33, 0.0002, { layer: "RYA_MER_5_MULTIPOLYGON" });
  const resolved = resolveOverlayHits([
    { building: primary, meters: 0 },
    { building: copy, meters: 0 },
  ]);
  assert.equal(resolved.building.id, 1);

  const other = squareBuilding(3, "B2", 38.36, 38.33);
  const amb = resolveOverlayHits([
    { building: primary, meters: 0 },
    { building: other, meters: 0 },
  ]);
  assert.equal(amb.reason, REASON.AMBIGUOUS_BUILDING);

  const small = squareBuilding(10, "D-1", 38.36, 38.33, 0.0002, { layer: "Maks_Bina" });
  const large = squareBuilding(11, "REZERV", 38.36, 38.33, 0.002, { layer: "RYA_MER_5_MULTIPOLYGON" });
  const nested = resolveOverlayHits([
    { building: large, meters: 0 },
    { building: small, meters: 0 },
  ]);
  assert.equal(nested.building.id, 10);
  assert.equal(nested.overlay, "smallest_nested");

  const more = squareBuilding(21, "E BLOK", 38.36, 38.33, 0.0002, { sayacCount: 325 });
  const fewer = squareBuilding(22, "E BLOK", 38.36, 38.33, 0.0002, { sayacCount: 76 });
  const canonical = resolveOverlayHits([
    { building: fewer, meters: 0 },
    { building: more, meters: 0 },
  ]);
  assert.equal(canonical.building.id, 21);

  const named = squareBuilding(31, "DBT-2", 38.36, 38.33, 0.0002);
  const unnamed = squareBuilding(32, "Bina #4065", 38.36, 38.33, 0.0002);
  const namedWins = resolveOverlayHits([
    { building: unnamed, meters: 0 },
    { building: named, meters: 0 },
  ]);
  assert.equal(namedWins.building.id, 31);
});

test("block aliases are not merged by parser", () => {
  const dir = tmp();
  const path = join(dir, "d.csv");
  writeFileSync(
    path,
    "Bölge;Blok;Daire;Kat;DevEUI;Durum;Son Uplink;Kaydeden;Kayıt Tarihi;Notlar\nİKİZCE;A1;1;0;0000000000000001;active;;;;\nİKİZCE;A1 BLOK;1;0;0000000000000002;active;;;;\nİKİZCE;DB 1;1;0;0000000000000003;registered;;;;\nİKİZCE;DB1;1;0;0000000000000004;registered;;;;\n",
    "utf8"
  );
  const parsed = parseCsvDevices(path);
  assert.deepEqual(
    parsed.rows.map((r) => r.blok),
    ["A1", "A1 BLOK", "DB 1", "DB1"]
  );
  rmSync(dir, { recursive: true, force: true });
});

test("multiple DevEUI in the same apartment are kept", () => {
  const dir = tmp();
  const path = join(dir, "d.csv");
  writeFileSync(
    path,
    "Bölge;Blok;Daire;Kat;DevEUI;Durum;Son Uplink;Kaydeden;Kayıt Tarihi;Notlar\nİKİZCE;A1;Daire 1;0;000019c640010392;active;;;;\nİKİZCE;A1;Daire 1;0;000019c640012848;registered;;;;\n",
    "utf8"
  );
  const parsed = parseCsvDevices(path);
  assert.equal(parsed.rows.length, 2);
  assert.notEqual(parsed.rows[0].deveui, parsed.rows[1].deveui);
  rmSync(dir, { recursive: true, force: true });
});

function seedDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE binalar (
      id INTEGER PRIMARY KEY, value TEXT, layer TEXT, coordinates TEXT
    );
    CREATE TABLE bina_bilgi (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bina_id INTEGER NOT NULL UNIQUE,
      kat_sayisi INTEGER NOT NULL DEFAULT 0, daire_per_kat INTEGER NOT NULL DEFAULT 0,
      ortak_alan_sayisi INTEGER NOT NULL DEFAULT 0, toplam_bagımsız_bolum INTEGER NOT NULL DEFAULT 0,
      daire_sayisi INTEGER DEFAULT 0, has_zemin INTEGER DEFAULT 0,
      ada_parsel TEXT DEFAULT '', sokak TEXT DEFAULT '', dis_kapi_no TEXT DEFAULT ''
    );
    CREATE TABLE sayac (
      id INTEGER PRIMARY KEY AUTOINCREMENT, bina_id INTEGER NOT NULL, birim_no INTEGER NOT NULL,
      sayac_id TEXT DEFAULT '', sayac_markasi TEXT DEFAULT '', abone_no TEXT DEFAULT '',
      sicil_no TEXT DEFAULT '', UNIQUE(bina_id, birim_no)
    );
  `);
  const lat = 38.36;
  const lng = 38.33;
  const half = 0.0003;
  const coords = JSON.stringify([[
    [lat - half, lng - half],
    [lat - half, lng + half],
    [lat + half, lng + half],
    [lat + half, lng - half],
    [lat - half, lng - half],
  ]]);
  db.prepare("INSERT INTO binalar (id, value, layer, coordinates) VALUES (1,'A1','P_KONUT_MULTIPOLYGON',?)").run(coords);
  return db;
}

test("quality data is not overwritten by a different brand on the same meter", () => {
  const dir = tmp();
  const dbPath = join(dir, "b.db");
  const db = seedDb(dbPath);
  ensureMeterCoordTables(db);
  db.prepare(
    "INSERT INTO sayac (bina_id, birim_no, sayac_id, sayac_markasi, abone_no) VALUES (1,1,'1435754','Baylan','999')"
  ).run();
  const existing = db.prepare("SELECT * FROM sayac WHERE sayac_id='1435754'").get();
  const incomingMarka = MARKA_FROM_VALUE.POLIMETER_LORA_W;
  assert.notEqual(existing.sayac_markasi, incomingMarka);
  const plan = {
    sayacPlan: [
      {
        action: "skip",
        reason: REASON.WOULD_OVERWRITE_HIGHER_QUALITY_DATA,
        meter_number: "1435754",
        bina_id: 1,
        value: "POLIMETER_LORA_W",
        installation_number: "449956",
        agreement_number: "44768341",
        existing_id: existing.id,
      },
    ],
    binaBilgiCreate: [],
    devicePlan: [],
  };
  const applied = applyPlan(db, plan, { csvName: "y.csv", csvHash: "c" });
  assert.equal(applied.inserted, 0);
  const after = db.prepare("SELECT sayac_markasi, abone_no FROM sayac WHERE id=?").get(existing.id);
  assert.equal(after.sayac_markasi, "Baylan");
  assert.equal(after.abone_no, "999");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("second apply of the same insert plan does not duplicate rows", () => {
  const dir = tmp();
  const dbPath = join(dir, "b.db");
  const db = seedDb(dbPath);
  ensureMeterCoordTables(db);
  const plan = {
    sayacPlan: [
      {
        action: "insert",
        meter_number: "1435754",
        bina_id: 1,
        value: "BAYLAN_LORA_W",
        installation_number: "449956",
        agreement_number: "44768341",
      },
    ],
    binaBilgiCreate: [1],
    devicePlan: [
      {
        action: "insert",
        deveui: "000019c640010392",
        bolge: "İKİZCE",
        blok: "A1",
        daire: "Daire 1",
        kat: "0",
        durum: "active",
        son_uplink: "",
        kaydeden: "Can",
        kayit_tarihi: "",
        notlar: "",
        source_row: 3,
      },
    ],
  };
  applyPlan(db, plan, { csvName: "y.csv", csvHash: "c" });
  const count1 = db.prepare("SELECT COUNT(*) c FROM sayac").get().c;
  const devices1 = db.prepare("SELECT COUNT(*) c FROM lora_devices").get().c;
  const unchangedPlan = {
    sayacPlan: [{ ...plan.sayacPlan[0], action: "unchanged", existing_id: 1 }],
    binaBilgiCreate: [],
    devicePlan: [{ ...plan.devicePlan[0], action: "unchanged", existing_id: 1 }],
  };
  applyPlan(db, unchangedPlan, { csvName: "y.csv", csvHash: "c" });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sayac").get().c, count1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM lora_devices").get().c, devices1);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("backup helper writes a restore file", () => {
  const dir = tmp();
  const dbPath = join(dir, "b.db");
  const db = seedDb(dbPath);
  db.close();
  const backupDir = join(dir, "backups");
  const backup = createDbBackup(dbPath, backupDir, "test");
  assert.equal(existsSync(backup.backupPath), true);
  assert.ok(backup.size > 0);
  rmSync(dir, { recursive: true, force: true });
});

test("transaction rolls back on error", () => {
  const dir = tmp();
  const dbPath = join(dir, "b.db");
  const db = seedDb(dbPath);
  ensureMeterCoordTables(db);
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO sayac (bina_id, birim_no, sayac_id) VALUES (1, 2, 'ABC')").run();
  db.exec("ROLLBACK");
  const c = db.prepare("SELECT COUNT(*) c FROM sayac").get().c;
  assert.equal(c, 0);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("normalization collision is detectable from distinct raw values sharing digits", () => {
  const a = normalizeMeterNumber("1435754").normalized;
  const b = normalizeMeterNumber("1435754.0").normalized;
  assert.equal(a, b);
  const keptZero = normalizeMeterNumber("01435754").normalized;
  assert.equal(keptZero, "01435754");
  assert.notEqual(keptZero, a);
});

test("abone-location Excel schema is detected and parsed without guessing DevEUI", () => {
  const dir = tmp();
  const path = join(dir, "sayac.xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    {
      "abone no": 192210,
      location: "POINT (470369.3662 4246557.9417)",
      "sayac no": "3437138",
      "sayaç marka": "GÜNAL",
      "üretim yılı": 2000,
      "damga yılı": 2000,
    },
    {
      "abone no": 418647.0,
      location: "POINT (470239.863934059 4246576.03303522)",
      "sayac no": 23660451.0,
      "sayaç marka": "KLEPSAN",
      "üretim yılı": 2023,
      "damga yılı": 2023,
    },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "konum");
  XLSX.writeFile(wb, path);
  assert.equal(detectExcelSchema({
    "abone no": 1,
    location: "POINT (1 2)",
    "sayac no": "3",
  }), EXCEL_SCHEMA.ABONE_LOCATION);
  const parsed = readCoordinateWorkbook(path);
  assert.equal(parsed.schema, EXCEL_SCHEMA.ABONE_LOCATION);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].meter_number, "3437138");
  assert.equal(parsed.rows[0].abone_no, "192210");
  assert.equal(parsed.rows[0].sayac_markasi, "GÜNAL");
  assert.equal(parsed.rows[0].installation_number, "");
  assert.equal(parsed.rows[1].meter_number, "23660451");
  assert.ok(parsed.rows[0].point);
  rmSync(dir, { recursive: true, force: true });
});

test("resolveMarka keeps explicit brands and maps LoRa codes", () => {
  assert.equal(resolveMarka({ sayac_markasi: "GÜNAL", value: "GÜNAL" }), "GÜNAL");
  assert.equal(resolveMarka({ value: "BAYLAN_LORA_W" }), "Baylan");
  assert.equal(resolveMarka({ value: "unknown-code" }), "");
});

test("empty bina_bilgi is filled from unique abone counts without duplicating meters", () => {
  const dir = tmp();
  const dbPath = join(dir, "b.db");
  const db = seedDb(dbPath);
  ensureMeterCoordTables(db);
  db.prepare(
    "INSERT INTO sayac (bina_id, birim_no, sayac_id, abone_no, kaynak) VALUES (1,1,'3437138','192210','sayac-xlsx-import')"
  ).run();
  db.prepare(
    "INSERT INTO sayac (bina_id, birim_no, sayac_id, abone_no, kaynak) VALUES (1,2,'23660451','418647','sayac-xlsx-import')"
  ).run();
  db.prepare(
    "INSERT INTO bina_bilgi (bina_id, kat_sayisi, daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum, has_zemin) VALUES (1,0,0,0,0,0)"
  ).run();
  const applied = applyPlan(
    db,
    {
      sayacPlan: [
        { action: "unchanged", meter_number: "3437138", bina_id: 1, abone_no: "192210" },
        { action: "unchanged", meter_number: "23660451", bina_id: 1, abone_no: "418647" },
      ],
      binaBilgiCreate: [],
      devicePlan: [],
    },
    { csvName: "", csvHash: null, adaByBinaId: new Map([[1, "704"]]) }
  );
  assert.equal(applied.inserted, 0);
  assert.equal(applied.bilgiFilled, 1);
  const bilgi = db.prepare("SELECT daire_sayisi, toplam_bagımsız_bolum, has_zemin, ada_parsel FROM bina_bilgi WHERE bina_id=1").get();
  assert.equal(bilgi.daire_sayisi, 2);
  assert.equal(bilgi.toplam_bagımsız_bolum, 2);
  assert.equal(bilgi.has_zemin, 1);
  assert.equal(bilgi.ada_parsel, "704");
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sayac").get().c, 2);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("abone-location insert writes abone_no and brand, not tesisat", () => {
  const dir = tmp();
  const dbPath = join(dir, "b.db");
  const db = seedDb(dbPath);
  ensureMeterCoordTables(db);
  const applied = applyPlan(
    db,
    {
      sayacPlan: [
        {
          action: "insert",
          meter_number: "3437138",
          bina_id: 1,
          value: "GÜNAL",
          sayac_markasi: "GÜNAL",
          abone_no: "192210",
          installation_number: "",
          agreement_number: "",
          kaynak: "sayac-xlsx-import",
        },
      ],
      binaBilgiCreate: [1],
      devicePlan: [],
    },
    { csvName: "", csvHash: null }
  );
  assert.equal(applied.inserted, 1);
  const row = db.prepare("SELECT sayac_id, sayac_markasi, abone_no, tesisat_no, sozlesme_no FROM sayac").get();
  assert.equal(row.sayac_id, "3437138");
  assert.equal(row.sayac_markasi, "GÜNAL");
  assert.equal(row.abone_no, "192210");
  assert.equal(row.tesisat_no, "");
  const bilgi = db.prepare("SELECT daire_sayisi, ortak_alan_sayisi, toplam_bagımsız_bolum, has_zemin FROM bina_bilgi WHERE bina_id=1").get();
  assert.equal(bilgi.daire_sayisi, 1);
  assert.equal(bilgi.ortak_alan_sayisi, 0);
  assert.equal(bilgi.toplam_bagımsız_bolum, 1);
  assert.equal(bilgi.has_zemin, 1);
  const blok = db.prepare("SELECT blok_no FROM sayac WHERE sayac_id='3437138'").get();
  assert.equal(blok.blok_no, "A1");
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

