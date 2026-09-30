import { useAppSettings } from "../contexts/AppSettingsContext";
import { useEffect } from "react";

export function AppTitleBar() {
  const { settings } = useAppSettings();

  useEffect(() => {
    void window.electronAPI
      ?.setTitleBarOverlay(settings.uiTheme)
      .catch(() => undefined);
  }, [settings.uiTheme]);

  return (
    <div className="app-titlebar fixed inset-x-0 top-0 z-[60] flex h-[20px] items-center bg-transparent px-3 pr-36 text-muted-foreground"></div>
  );
}
