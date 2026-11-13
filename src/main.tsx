import "@fontsource/ibm-plex-sans-arabic/arabic-400.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-500.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-600.css";
import "@fontsource/ibm-plex-sans-arabic/arabic-700.css";
import { DirectionProvider } from "@radix-ui/react-direction";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { dir, lang } from "./i18n";
import "./index.css";

// Set before the first paint so the page never flashes in the wrong direction.
document.documentElement.lang = lang;
document.documentElement.dir = dir;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DirectionProvider dir={dir}>
      <App />
    </DirectionProvider>
  </StrictMode>,
);
