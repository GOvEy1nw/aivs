import {
  ExternalLink,
  FileText,
  Folder,
  Info,
  Moon,
  Package,
  Settings,
  SlidersHorizontal,
  Sun,
  X,
} from "lucide-react";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { logger } from "../lib/logger";
import {
  useAppSettings,
  type AppSettings,
} from "../contexts/AppSettingsContext";
import { AivsLogo } from "./AivsLogo";
import { ModelPackManager } from "./ModelPackManager";
import { LogViewer } from "./LogViewer";
import { useModelProfiles } from "../contexts/ModelProfilesContext";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: TabId;
}

export type SettingsTabId = "general" | "models" | "advanced" | "logs" | "about";
type TabId = SettingsTabId;

interface FolderLocation {
  path: string;
  custom: boolean;
  defaultPath: string;
}

type AdvancedSettings = Pick<
  AppSettings,
  | "useTorchCompile"
  | "attentionMode"
  | "performanceProfile"
  | "reduceVram"
  | "previewSettings"
>;

function getAdvancedSettings(settings: AppSettings): AdvancedSettings {
  return {
    useTorchCompile: settings.useTorchCompile,
    attentionMode: settings.attentionMode,
    performanceProfile: settings.performanceProfile,
    reduceVram: settings.reduceVram,
    previewSettings: { ...settings.previewSettings },
  };
}

export function SettingsModal({
  isOpen,
  onClose,
  initialTab,
}: SettingsModalProps) {
  const { settings, setUiTheme, updateSettings, saveSettings } = useAppSettings();
  const { refreshAfterModelPackMutation } = useModelProfiles();
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [appVersion, setAppVersion] = useState("");
  const [noticesText, setNoticesText] = useState<string | null>(null);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const [showNotices, setShowNotices] = useState(false);
  const [modelLicenseText, setModelLicenseText] = useState<string | null>(null);
  const [modelLicenseLoading, setModelLicenseLoading] = useState(false);
  const [showModelLicense, setShowModelLicense] = useState(false);
  const [projectAssetsPath, setProjectAssetsPath] = useState("");
  const [projectAssetsNeedsReselection, setProjectAssetsNeedsReselection] = useState(false);
  const [legacyProjectAssetsPath, setLegacyProjectAssetsPath] = useState<string | undefined>();
  const [advancedSettings, setAdvancedSettings] = useState<AdvancedSettings>(
    () => getAdvancedSettings(settings),
  );
  const [advancedSaving, setAdvancedSaving] = useState(false);
  const [advancedSaveError, setAdvancedSaveError] = useState<string | null>(
    null,
  );
  const [advancedReloaded, setAdvancedReloaded] = useState(false);
  const [checkpointsLocation, setCheckpointsLocation] =
    useState<FolderLocation | null>(null);
  const [savedCheckpointsLocation, setSavedCheckpointsLocation] =
    useState<FolderLocation | null>(null);
  const [lorasLocation, setLorasLocation] =
    useState<FolderLocation | null>(null);
  const [savedLorasLocation, setSavedLorasLocation] =
    useState<FolderLocation | null>(null);
  const [openingWanGP, setOpeningWanGP] = useState(false);
  const [openWanGPError, setOpenWanGPError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (activeTab !== "about" || appVersion) return;
    window.electronAPI
      .getAppInfo()
      .then((info) => setAppVersion(info.version))
      .catch(() => {});
  }, [activeTab, appVersion]);

  useEffect(() => {
    if (!isOpen) return;
    window.electronAPI
      .getProjectAssetsPathStatus()
      .then((status) => {
        setProjectAssetsPath(status.path);
        setProjectAssetsNeedsReselection(status.needsReselection);
        setLegacyProjectAssetsPath(status.legacyPath);
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setAdvancedSettings(getAdvancedSettings(settings));
    setAdvancedSaveError(null);
    setAdvancedReloaded(false);
    Promise.all([
      window.electronAPI.getCheckpointsLocation(),
      window.electronAPI.getLorasLocation(),
    ])
      .then(([checkpoints, loras]) => {
        setCheckpointsLocation(checkpoints);
        setSavedCheckpointsLocation(checkpoints);
        setLorasLocation(loras);
        setSavedLorasLocation(loras);
      })
      .catch((error: unknown) => {
        setAdvancedSaveError(
          error instanceof Error ? error.message : String(error),
        );
      });
  }, [
    isOpen,
    settings.attentionMode,
    settings.performanceProfile,
    settings.reduceVram,
    settings.previewSettings,
    settings.useTorchCompile,
  ]);

  const advancedDirty =
    advancedSettings.useTorchCompile !== settings.useTorchCompile ||
    advancedSettings.attentionMode !== settings.attentionMode ||
    advancedSettings.performanceProfile !== settings.performanceProfile ||
    advancedSettings.reduceVram !== settings.reduceVram ||
    Object.entries(advancedSettings.previewSettings).some(
      ([key, value]) =>
        value !==
        settings.previewSettings[key as keyof typeof settings.previewSettings],
    ) ||
    checkpointsLocation?.path !== savedCheckpointsLocation?.path ||
    checkpointsLocation?.custom !== savedCheckpointsLocation?.custom ||
    lorasLocation?.path !== savedLorasLocation?.path ||
    lorasLocation?.custom !== savedLorasLocation?.custom;

  const handleSaveAdvancedSettings = async () => {
    setAdvancedSaving(true);
    setAdvancedSaveError(null);
    setAdvancedReloaded(false);
    try {
      await saveSettings(advancedSettings);
      if (
        checkpointsLocation &&
        (checkpointsLocation.path !== savedCheckpointsLocation?.path ||
          checkpointsLocation.custom !== savedCheckpointsLocation?.custom)
      ) {
        const savedLocation = await window.electronAPI.setCheckpointsLocation(
          checkpointsLocation.custom ? checkpointsLocation.path : null,
        );
        setCheckpointsLocation(savedLocation);
        setSavedCheckpointsLocation(savedLocation);
      }
      if (
        lorasLocation &&
        (lorasLocation.path !== savedLorasLocation?.path ||
          lorasLocation.custom !== savedLorasLocation?.custom)
      ) {
        const savedLocation = await window.electronAPI.setLorasLocation(
          lorasLocation.custom ? lorasLocation.path : null,
        );
        setLorasLocation(savedLocation);
        setSavedLorasLocation(savedLocation);
      }
      await window.electronAPI.restartPythonBackend();
      await window.electronAPI.refreshModelPacks();
      await refreshAfterModelPackMutation();
      setAdvancedReloaded(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to save advanced settings and reload inference engine: ${message}`,
      );
      setAdvancedSaveError(message);
    } finally {
      setAdvancedSaving(false);
    }
  };

  const handleOpenWanGP = async () => {
    setOpeningWanGP(true);
    setOpenWanGPError(null);
    try {
      await window.electronAPI.openWanGP();
    } catch (error) {
      setOpenWanGPError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningWanGP(false);
    }
  };

  const handleLoadModelLicense = async () => {
    setModelLicenseLoading(true);
    try {
      const text = await window.electronAPI.fetchLicenseText();
      setModelLicenseText(text);
      setShowModelLicense(true);
    } catch (e) {
      logger.error(`Failed to load model license: ${e}`);
    } finally {
      setModelLicenseLoading(false);
    }
  };

  const handleLoadNotices = async () => {
    setNoticesLoading(true);
    try {
      const text = await window.electronAPI.getNoticesText();
      setNoticesText(text);
      setShowNotices(true);
    } catch (e) {
      logger.error(`Failed to load notices: ${e}`);
    } finally {
      setNoticesLoading(false);
    }
  };

  const tabs = [
    { id: "general" as TabId, label: "General", icon: Settings },
    { id: "models" as TabId, label: "Model Manager", icon: Package },
    { id: "advanced" as TabId, label: "Advanced", icon: SlidersHorizontal },
    { id: "logs" as TabId, label: "Logs", icon: FileText },
    { id: "about" as TabId, label: "About", icon: Info },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-overlay/60 backdrop-blur-xs"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative flex h-[min(820px,88vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-7 py-5">
          <h2 className="text-xl font-semibold text-foreground">Settings</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Tabs */}
          <nav className="w-56 shrink-0 border-r border-border bg-background p-4 sm:w-64">
            <div className="space-y-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? "bg-surface-selected text-foreground"
                        : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${activeTab === tab.id ? "text-blue-400" : "text-subtle-foreground"}`} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-7 overflow-y-auto px-7 py-6 sm:px-10 sm:py-8">
          {activeTab === "general" && (
            <>
              <fieldset className="space-y-3 border-b border-border pb-6">
                <legend className="text-sm font-semibold text-foreground">Appearance</legend>
                <p className="text-xs leading-relaxed text-subtle-foreground">Choose how AiVS looks on this device.</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "dark" as const, label: "Dark", icon: Moon },
                    { value: "light" as const, label: "Light", icon: Sun },
                  ].map(({ value, label, icon: Icon }) => {
                    const selected = settings.uiTheme === value;
                    return (
                      <label
                        key={value}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-card ${
                          selected
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-input text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                        }`}
                      >
                        <input
                          type="radio"
                          name="ui-theme"
                          value={value}
                          checked={selected}
                          onChange={() => setUiTheme(value)}
                          className="h-4 w-4 accent-primary"
                        />
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* Project Assets Path */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Folder className="h-4 w-4 text-blue-400" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Project Assets Path
                  </h3>
                </div>
                <p className="text-xs leading-relaxed text-muted">
                  Where generated video and image assets are saved. Each project
                  gets a subfolder.
                </p>
                {projectAssetsNeedsReselection && (
                  <p className="text-xs text-amber-300">
                    Previous project-assets folder was kept untouched: {legacyProjectAssetsPath}. Select it again to restore access.
                  </p>
                )}
                <div className="flex gap-2">
                  <div className="flex-1 px-3 py-2 rounded-lg bg-surface-raised border border-border text-foreground text-sm truncate select-text">
                    {projectAssetsPath || (
                      <span className="text-subtle-foreground">Not set</span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="border-border shrink-0"
                    onClick={async () => {
                      const result = await window.electronAPI.chooseProjectAssetsPath();
                      if (result.path) {
                        setProjectAssetsPath(result.path);
                        setProjectAssetsNeedsReselection(false);
                        setLegacyProjectAssetsPath(undefined);
                      }
                    }}
                  >
                    <Folder className="h-4 w-4" />
                  </Button>
                </div>
              </div>

            </>
          )}

          {activeTab === "models" && <ModelPackManager />}

          {activeTab === "advanced" && (
            <div className="space-y-5">
              {[
                {
                  key: "checkpoints",
                  label: "Custom WanGP Checkpoints Folder",
                  location: checkpointsLocation,
                  setLocation: setCheckpointsLocation,
                },
                {
                  key: "loras",
                  label: "Custom WanGP LoRAs Folder",
                  location: lorasLocation,
                  setLocation: setLorasLocation,
                },
              ].map(({ key, label, location, setLocation }) => (
                <div key={key} className="space-y-2">
                  <label className="text-sm font-medium text-foreground">{label}</label>
                  <div className="flex gap-2">
                    <div
                      className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground select-text"
                      title={location?.path}
                    >
                      {location?.path ?? "Loading…"}
                    </div>
                    {location?.custom && (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={advancedSaving}
                        onClick={() => {
                          setLocation((current) => current && {
                            ...current,
                            path: current.defaultPath,
                            custom: false,
                          });
                          setAdvancedReloaded(false);
                        }}
                        className="shrink-0 text-xs"
                      >
                        Use default
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0 border-border"
                      disabled={advancedSaving || !location}
                      onClick={async () => {
                        const directory = await window.electronAPI.showOpenDirectoryDialog({
                          title: `Select ${label}`,
                        });
                        if (!directory) return;
                        setLocation((current) => current && {
                          ...current,
                          path: directory,
                          custom: true,
                        });
                        setAdvancedReloaded(false);
                      }}
                    >
                      <Folder className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="space-y-2 border-t border-border pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-border"
                  disabled={openingWanGP}
                  onClick={() => void handleOpenWanGP()}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {openingWanGP ? "Opening WanGP…" : "Open WanGP"}
                </Button>
                {openWanGPError && (
                  <p className="text-xs text-red-400" role="alert">
                    Could not open WanGP: {openWanGPError}
                  </p>
                )}
              </div>
              {/* Torch Compile */}
              <div className="space-y-3 pt-4 border-t border-border">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-sm font-medium text-foreground">
                        Torch Compile
                      </label>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={advancedSaving}
                    onClick={() => {
                      setAdvancedSettings((current) => ({
                        ...current,
                        useTorchCompile: !current.useTorchCompile,
                      }));
                      setAdvancedReloaded(false);
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      advancedSettings.useTorchCompile
                        ? "bg-blue-600"
                        : "bg-surface-hover"
                    }`}
                    aria-pressed={advancedSettings.useTorchCompile}
                  >
                    <span
                className={`inline-block h-5 w-5 rounded-full bg-foreground shadow transition-transform ${
                        advancedSettings.useTorchCompile
                          ? "translate-x-5"
                          : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Attention Mode
                  </span>
                  <select
                    value={advancedSettings.attentionMode}
                    disabled={advancedSaving}
                    onChange={(event) => {
                      setAdvancedSettings((current) => ({
                        ...current,
                        attentionMode: event.target
                          .value as AdvancedSettings["attentionMode"],
                      }));
                      setAdvancedReloaded(false);
                    }}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  >
                    <option value="auto">Auto (Recommended)</option>
                    <option value="sdpa">PyTorch (Compatible)</option>
                    <option value="flash">Flash Attention</option>
                    <option value="xformers">xFormers (Lower VRAM)</option>
                    <option value="sage">SageAttention</option>
                    <option value="sage2">SageAttention 2</option>
                    <option value="sage3">SageAttention 3</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Performance Profile
                  </span>
                  <select
                    value={advancedSettings.performanceProfile}
                    disabled={advancedSaving}
                    onChange={(event) => {
                      setAdvancedSettings((current) => ({
                        ...current,
                        performanceProfile: Number(
                          event.target.value,
                        ) as AdvancedSettings["performanceProfile"],
                      }));
                      setAdvancedReloaded(false);
                    }}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  >
                    <option value="1">1 — Fastest (High RAM + VRAM)</option>
                    <option value="2">2 — Fast (High RAM)</option>
                    <option value="3">3 — Full Model in VRAM (24GB+)</option>
                    <option value="4">4 — Balanced (Recommended)</option>
                    <option value="4.5">4+ — Lower VRAM</option>
                    <option value="5">5 — Minimum RAM</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-foreground">
                    Reduce VRAM
                  </span>
                  <select
                    value={advancedSettings.reduceVram}
                    disabled={advancedSaving}
                    onChange={(event) => {
                      setAdvancedSettings((current) => ({
                        ...current,
                        reduceVram: event.target
                          .value as AdvancedSettings["reduceVram"],
                      }));
                      setAdvancedReloaded(false);
                    }}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  >
                    <option value="disabled">Disabled</option>
                    <option value="1">Level 1 (16GB+)</option>
                    <option value="2">Level 2 (8GB+)</option>
                    <option value="3">Level 3 (6GB+)</option>
                  </select>
                </label>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Generation Previews</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Tiny VAE provides clearer previews where supported; other models use Fast RGB. Video previews show motion, while image generations keep still previews.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <label className="space-y-1.5">
                    <span className="text-xs text-muted">Mode</span>
                    <select
                      value={advancedSettings.previewSettings.mode === "off" ? "rgb" : advancedSettings.previewSettings.mode}
                      disabled={advancedSaving}
                      onChange={(event) => {
                        setAdvancedSettings((current) => ({ ...current, previewSettings: { ...current.previewSettings, mode: event.target.value as typeof current.previewSettings.mode } }));
                        setAdvancedReloaded(false);
                      }}
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    >
                      <option value="rgb">Fast RGB</option>
                      <option value="tiny_vae_frames">Tiny VAE frames</option>
                      <option value="tae">Tiny VAE video</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-xs leading-relaxed text-muted">
                  Changes stay pending until saved. Reloading inference engine
                  interrupts any active generation.
                </p>
                <Button
                  type="button"
                  onClick={() => void handleSaveAdvancedSettings()}
                  disabled={
                    advancedSaving || (!advancedDirty && !advancedSaveError)
                  }
                  className="w-full"
                >
                  {advancedSaving ? "Saving & Reloading…" : "Save & Reload"}
                </Button>
                {advancedSaveError && (
                  <p className="text-xs text-red-400" role="alert">
                    Save or reload failed: {advancedSaveError}
                  </p>
                )}
                {advancedReloaded && (
                  <p className="text-xs text-emerald-400" role="status">
                    Settings saved. Inference engine reloaded.
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === "logs" && (
            <div className="h-[calc(min(820px,88vh)-12rem)] min-h-96">
              <LogViewer isOpen={true} onClose={() => {}} embedded />
            </div>
          )}

          {activeTab === "general" && (
            <div className="space-y-5">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Video Quality
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="text-xs text-muted">Container</span>
                    <select
                      value={settings.outputSettings.videoContainer}
                      onChange={(event) => {
                        const videoContainer = event.target.value as
                          | "mp4"
                          | "mov"
                          | "mkv";
                        updateSettings((prev) => ({
                          ...prev,
                          outputSettings: {
                            ...prev.outputSettings,
                            videoContainer,
                            videoCodec:
                              videoContainer === "mp4" &&
                              prev.outputSettings.videoCodec === "prores_422"
                                ? "libx264_8"
                                : prev.outputSettings.videoCodec,
                          },
                        }));
                      }}
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    >
                      <option value="mp4">MP4</option>
                      <option value="mov">MOV</option>
                      <option value="mkv">MKV</option>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs text-muted">Codec</span>
                    <select
                      value={settings.outputSettings.videoCodec}
                      onChange={(event) =>
                        updateSettings((prev) => ({
                          ...prev,
                          outputSettings: {
                            ...prev.outputSettings,
                            videoCodec: event.target
                              .value as typeof prev.outputSettings.videoCodec,
                          },
                        }))
                      }
                      className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                    >
                      <option value="libx264_8">x264 Medium</option>
                      <option value="libx264_10">x264 High</option>
                      <option value="libx265_28">x265 Medium</option>
                      <option value="libx265_8">x265 Very High</option>
                      <option value="libx264_lossless">x264 Lossless</option>
                      <option
                        value="prores_422"
                        disabled={
                          settings.outputSettings.videoContainer === "mp4"
                        }
                      >
                        ProRes 422
                      </option>
                    </select>
                  </label>
                </div>
                <label className="space-y-1 block">
                  <span className="text-xs text-muted">Audio Format</span>
                  <select
                    value={settings.outputSettings.audioCodec}
                    onChange={(event) =>
                      updateSettings((prev) => ({
                        ...prev,
                        outputSettings: {
                          ...prev.outputSettings,
                          audioCodec: event.target
                            .value as typeof prev.outputSettings.audioCodec,
                        },
                      }))
                    }
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                  >
                    <option value="aac_128">AAC 128 kbps</option>
                    <option value="aac_192">AAC 192 kbps</option>
                    <option value="aac_256">AAC 256 kbps</option>
                    <option value="aac_320">AAC 320 kbps</option>
                  </select>
                </label>
                <p className="text-xs text-subtle-foreground">
                  HDR output support depends on selected WanGP codec and model.
                </p>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Image Quality
                </h3>
                <select
                  value={settings.outputSettings.imageCodec}
                  onChange={(event) =>
                    updateSettings((prev) => ({
                      ...prev,
                      outputSettings: {
                        ...prev.outputSettings,
                        imageCodec: event.target
                          .value as typeof prev.outputSettings.imageCodec,
                      },
                    }))
                  }
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground"
                >
                  <option value="jpeg">JPEG q95</option>
                  <option value="webp">WebP q95</option>
                  <option value="png">PNG lossless</option>
                  <option value="webp_lossless">WebP lossless</option>
                </select>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">
                  Metadata Output
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: "metadata", label: "Embed metadata" },
                    { value: "json", label: "Export JSON files" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() =>
                        updateSettings((prev) => ({
                          ...prev,
                          outputSettings: {
                            ...prev.outputSettings,
                            metadataMode: option.value as "metadata" | "json",
                          },
                        }))
                      }
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        settings.outputSettings.metadataMode === option.value
                          ? "border-blue-500 bg-blue-500/10 text-primary-foreground"
                          : "border-border bg-surface-raised text-muted-foreground"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={
                      settings.outputSettings.keepIntermediateSlidingWindows
                    }
                    onChange={(event) =>
                      updateSettings((prev) => ({
                        ...prev,
                        outputSettings: {
                          ...prev.outputSettings,
                          keepIntermediateSlidingWindows: event.target.checked,
                        },
                      }))
                    }
                    className="h-4 w-4 accent-blue-500"
                  />
                  Keep intermediate sliding windows
                </label>
              </div>
            </div>
          )}

          {activeTab === "about" && (
            <>
              {showModelLicense ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      Model License
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowModelLicense(false)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-raised"
                    >
                      Back
                    </Button>
                  </div>
                  <pre className="text-xs text-foreground whitespace-pre-wrap font-mono bg-surface-raised/50 rounded-lg p-4 max-h-[50vh] overflow-y-auto border border-border/50">
                    {modelLicenseText}
                  </pre>
                </div>
              ) : showNotices ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      Third-Party Notices
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowNotices(false)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-raised"
                    >
                      Back
                    </Button>
                  </div>
                  <pre className="text-xs text-foreground whitespace-pre-wrap font-mono bg-surface-raised/50 rounded-lg p-4 max-h-[50vh] overflow-y-auto border border-border/50">
                    {noticesText}
                  </pre>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* App Identity */}
                  <div className="text-center space-y-2 flex flex-col">
                    <AivsLogo className="h-12 w-auto text-foreground mx-auto mb-2" />
                    <p className="text-xs text-subtle-foreground mb-3">
                      Local-Only AI Video Studio
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Version {appVersion || "..."}
                    </p>
                  </div>

                  {/* License */}
                  <div className="bg-surface-raised/50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Info className="h-4 w-4 text-blue-400" />
                      <span className="text-sm font-medium text-foreground">
                        License
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Licensed under the Apache License, Version 2.0
                    </p>
                  </div>

                  {/* Model License */}
                  <div className="bg-surface-raised/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-4 w-4 text-blue-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                      </svg>
                      <span className="text-sm font-medium text-foreground">
                        Model Licenses
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      AI models are subject to their respective license
                      agreements.
                    </p>
                    <Button
                      size="sm"
                      onClick={handleLoadModelLicense}
                      disabled={modelLicenseLoading}
                      className="w-full bg-surface-hover hover:bg-surface-hover text-foreground text-xs"
                    >
                      {modelLicenseLoading
                        ? "Loading..."
                        : "View Model License"}
                    </Button>
                  </div>

                  {/* Third-Party Notices */}
                  <div className="bg-surface-raised/50 rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-4 w-4 text-blue-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                      </svg>
                      <span className="text-sm font-medium text-foreground">
                        Third-Party Notices
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This application uses open-source software and AI models
                      subject to their own license terms.
                    </p>
                    <Button
                      size="sm"
                      onClick={handleLoadNotices}
                      disabled={noticesLoading}
                      className="w-full bg-surface-hover hover:bg-surface-hover text-foreground text-xs"
                    >
                      {noticesLoading
                        ? "Loading..."
                        : "View Third-Party Notices"}
                    </Button>
                  </div>

                  {/* Built on WanGP */}
                  <div className="bg-surface-raised/50 rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <svg
                        className="h-4 w-4 text-green-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                      <span className="text-sm font-medium text-foreground">
                        Powered by WanGP
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-7 py-4">
          <Button
            onClick={onClose}
            className="bg-surface-hover hover:bg-surface-hover text-foreground"
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
