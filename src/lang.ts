/** Supported UI languages — the single source of truth (types, dropdown, and
 *  the settings-validation guard all derive from here). */
export type Lang = "zh" | "zh-Hans" | "en" | "ja";

export const LANGS: { value: Lang; label: string }[] = [
  { value: "zh", label: "繁體中文" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

export const LANG_VALUES: Lang[] = LANGS.map((l) => l.value);

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANG_VALUES as string[]).includes(v);
}
