// Window names used in the data files and formula references (browser-safe).
export const WINDOWS = ["YTD", "L3", "Home", "Away", "Prior"] as const;
export type WindowName = (typeof WINDOWS)[number];
