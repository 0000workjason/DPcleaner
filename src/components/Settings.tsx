import { useStore } from "../store";
import { useT, LANGS, type Lang } from "../i18n";

export function Settings() {
  const t = useT();
  const openFlag = useStore((s) => s.settingsOpen);
  const closeIt = useStore((s) => s.openSettings);
  const settings = useStore((s) => s.settings);
  const saveSetting = useStore((s) => s.saveSetting);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);

  if (!openFlag) return null;

  return (
    <div className="modal-backdrop" onClick={() => closeIt(false)}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t("settings.title")}</h3>

        <section className="row gap">
          <label>
            {t("settings.language")}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
            >
              {LANGS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("settings.theme")}
            <select
              value={(settings.theme as string) || "dark"}
              onChange={(e) => saveSetting("theme", e.target.value)}
            >
              <option value="dark">{t("settings.themeDark")}</option>
              <option value="light">{t("settings.themeLight")}</option>
            </select>
          </label>
          <label>
            {t("settings.device")}
            <select
              value={(settings.device as string) || "auto"}
              onChange={(e) =>
                saveSetting(
                  "device",
                  e.target.value === "auto" ? "" : e.target.value,
                )
              }
            >
              <option value="auto">{t("settings.deviceAuto")}</option>
              <option value="cuda">GPU (cuda)</option>
              <option value="cpu">CPU</option>
            </select>
          </label>
        </section>

        <div className="modal-actions">
          <button className="primary" onClick={() => closeIt(false)}>
            {t("settings.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
