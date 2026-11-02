import "@fontsource-variable/inter";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { LiveProvider } from "./live.tsx";
import { initPrefs } from "./prefs.ts";
import { ToastProvider } from "./ui/toasts.tsx";
import "./styles.css";
import "./atelier.css";

initPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <LiveProvider>
        <App />
      </LiveProvider>
    </ToastProvider>
  </StrictMode>,
);
