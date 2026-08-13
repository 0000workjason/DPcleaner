import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { THEME_KEY } from "./store";
import "./styles.css";

// Paint the remembered theme before the first render. The real value lives in
// the backend's settings file, which needs the engine to be up -- seconds on a
// cold start -- so a light-theme user would otherwise stare at a dark splash
// and then get a flash when GET /settings finally lands.
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark")
    document.documentElement.dataset.theme = saved;
} catch {
  /* private mode / storage disabled - fall back to the CSS default */
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
