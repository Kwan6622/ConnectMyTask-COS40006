import { useEffect, useState } from 'react';
import { api } from "@/services/api";

export interface City {
  id: number;
  name: string;
}

export interface Ward {
  id: number;
  cityId: number;
  /** English name without accents or unit word, e.g. "Ben Thanh" */
  name: string;
  type: 'ward' | 'commune' | 'special_zone';
}

/** "Bến Thành" -> "ben thanh": typing with or without accents both match. */
export const toSearchText = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Names are shown in English only: no accents and no Vietnamese unit word
 * (the unit shows as the small Ward / Commune hint instead). The server already
 * sends them this way; this also cleans any older copy still cached somewhere.
 */
export const toEnglishName = (value: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/^(Phuong|Xa|Dac khu)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const TYPE_WORDS =/^(phuong|xa|dac khu|ward|commune|p)\s+/;

/**
 * Wards closest to what was typed: name starts with it, then a word starts
 * with it, then it appears anywhere. "ben th", "Bến Thành" and "Ben Thanh" all work.
 */
export function rankWards(wards: Ward[], query: string, limit = 8): Ward[] {
  const q = toSearchText(query).replace(TYPE_WORDS, '');
  if (!q) return wards.slice(0, limit);
  const scored: Array<{ ward: Ward; score: number }> = [];
  for (const ward of wards) {
    const short = toSearchText(ward.name);
    let score = -1;
    if (short === q) score = 0;
    else if (short.startsWith(q)) score = 1;
    else if (short.split(' ').some((word) => word.startsWith(q))) score = 2;
    else if (short.includes(q)) score = 3;
    if (score >= 0) scored.push({ ward, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.ward.name.localeCompare(b.ward.name, 'en'))
    .slice(0, limit)
    .map((item) => item.ward);
}

export const WARD_TYPE_LABEL: Record<Ward['type'], string> = {
  ward: 'Ward',
  commune: 'Commune',
  special_zone: 'Special zone',
};

// The lists rarely change, so fetch each one once per page load.
let citiesPromise: Promise<City[]> | null = null;
const wardsPromises = new Map<number, Promise<Ward[]>>();

function loadCities(): Promise<City[]> {
  if (!citiesPromise) {
    citiesPromise = api.locations.cities()
      .then((res) => res.data.cities as City[])
      .catch((error) => { citiesPromise = null; throw error; });
  }
  return citiesPromise;
}

function loadWards(cityId: number): Promise<Ward[]> {
  if (!wardsPromises.has(cityId)) {
    wardsPromises.set(cityId, api.locations.wards(cityId)
      .then((res) => (res.data.wards as Ward[]).map((ward) => ({ ...ward, name: toEnglishName(ward.name) })))
      .catch((error) => { wardsPromises.delete(cityId); throw error; }));
  }
  return wardsPromises.get(cityId)!;
}

export function useCities() {
  const [cities, setCities] = useState<City[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    loadCities().then((list) => active && setCities(list)).catch(() => active && setError(true));
    return () => { active = false; };
  }, []);
  return { cities, error };
}

export function useWards(cityId: number | null | undefined) {
  const [wards, setWards] = useState<Ward[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    if (!cityId) { setWards([]); return undefined; }
    setLoading(true);
    loadWards(cityId)
      .then((list) => active && setWards(list))
      .catch(() => active && setWards([]))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [cityId]);
  return { wards, loading };
}
