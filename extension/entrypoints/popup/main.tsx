/**
 * Popup entrypoint. Mounts the React tree with Sonner toaster.
 *
 * Tailwind/shadcn styles are picked up via WXT's @wxt-dev/module-react —
 * the popup reuses the Next.js project's globals.css by aliasing it. For a
 * standalone build, copy `src/app/globals.css` to `entrypoints/popup/
 * styles.css` and import it here.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { App } from "./App";
import "./styles.css";

const el = document.getElementById("root");
if (!el) throw new Error("popup: missing #root element");

createRoot(el).render(
  <StrictMode>
    <App />
    <Toaster position="bottom-center" richColors closeButton />
  </StrictMode>,
);
