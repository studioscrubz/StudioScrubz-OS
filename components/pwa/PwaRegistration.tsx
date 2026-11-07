"use client";

import { isPartnerHost } from "@/lib/contractors/host";
import { useEffect } from "react";
import { registerStudioScrubzServiceWorker } from "@/lib/services/pushNotifications";

export function PwaRegistration() {
  useEffect(() => {
    if (isPartnerHost(window.location.host) || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const register = () => registerStudioScrubzServiceWorker()
      .then((registration) => registration.update())
      .catch((error: unknown) => console.error("StudioScrubz service worker registration failed", error));
    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
