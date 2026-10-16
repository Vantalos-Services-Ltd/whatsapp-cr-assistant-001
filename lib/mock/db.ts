/**
 * Holds the fake backend's data for the current browser.
 *
 * State is kept in memory and mirrored to localStorage so approvals, edits and
 * new jobs survive a page refresh. resetDemoDb() rebuilds it from the seed.
 */
import { buildSeed, DB_VERSION, type MockDb } from "./seed";

const STORAGE_KEY = "vantalos-demo-db";

let db: MockDb | null = null;

function load(): MockDb {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed?.version === DB_VERSION) return parsed;
    }
  } catch {
    // storage unavailable or corrupt — fall through to a fresh seed
  }
  return buildSeed();
}

export function getDb(): MockDb {
  if (!db) {
    db = typeof window === "undefined" ? buildSeed() : load();
    saveDb();
  }
  return db;
}

export function saveDb(): void {
  if (!db || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // ignore quota / private-mode errors; the in-memory copy still works
  }
}

export function resetDemoDb(): void {
  db = buildSeed();
  saveDb();
}

export function nextId(prefix: string): string {
  const d = getDb();
  d.seq += 1;
  return `${prefix}_${d.seq.toString(36).padStart(4, "0")}`;
}
