import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Pieces to plan for an ordered quantity plus an allowance %, rounded half-up
 * per cell (115.5 -> 116, 115.49 -> 115). Exact integer maths in basis points so
 * it always agrees with the server (backend/lotmath.py), which is the value that
 * counts; this is only the live preview.
 */
export function plannedFromOrder(order, pct) {
  const bp = Math.round((Number(pct) || 0) * 100);
  return Math.floor(((parseInt(order, 10) || 0) * (10000 + bp) + 5000) / 10000);
}

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD for the user's own calendar day. `toISOString()` is UTC, which is
 *  still "yesterday" in India between midnight and 05:30. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The Saturday on or before a YYYY-MM-DD date: pay weeks run Saturday to Friday. */
export function weekStartOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 1) % 7));      // getDay(): Sun=0 ... Sat=6
  return localDate(dt);
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localDate(dt);
}

/** 24/10/2026 style, as the owner's reference calculator shows it. */
export function dmy(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
