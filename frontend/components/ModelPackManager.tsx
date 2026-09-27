import { useEffect, useState } from "react";
import { Download, RefreshCw, Square } from "lucide-react";
import type { ModelPackProgress } from "@/types/progress";
import {
  clampPercent,
  formatEta,
  formatTransferRate,
} from "../lib/transfer-format";
import { Button } from "./ui/button";
import { useModelProfiles } from "@/contexts/ModelProfilesContext";

interface ModelPack {
  id: string;
  name: string;
  estimatedSize: string;
  installed: boolean;
  groupId?: string;
  groupName?: string;
  variantName?: string;
  mediaTypes?: Array<"image" | "video" | "audio">;
  features?: string[];
  licenseUrl?: string;
}

interface ModelPackManagerProps {
  firstRun?: boolean;
  onContinue?: () => void;
}

interface ModelPackGroup {
  id: string;
  name: string;
  grouped: boolean;
  packs: ModelPack[];
}

function groupModelPacks(packs: ModelPack[]): ModelPackGroup[] {
  const groups = new Map<string, ModelPackGroup>();
  for (const pack of packs) {
    const id = pack.groupId ?? `pack:${pack.id}`;
    const existing = groups.get(id);
    if (existing) {
      existing.packs.push(pack);
      continue;
    }
    groups.set(id, {
      id,
      name: pack.groupName ?? pack.name,
      grouped: pack.groupId !== undefined,
      packs: [pack],
    });
  }
  return [...groups.values()];
}

export function ModelPackManager({
  firstRun = false,
  onContinue,
}: ModelPackManagerProps) {
  const { refreshAfterModelPackMutation } = useModelProfiles();
  const [packs, setPacks] = useState<ModelPack[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<ModelPackProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [operationActive, setOperationActive] = useState(false);
  const [failedPackId, setFailedPackId] = useState<string | null>(null);
  const [mediaFilter, setMediaFilter] = useState<
    "all" | "image" | "video" | "audio"
  >("all");
  const [featureFilters, setFeatureFilters] = useState<string[]>([]);
  const downloading =
    progress?.status === "preparing" || progress?.status === "downloading";
  const busy = operationActive || downloading || deleting !== null || checking;
  const selectedMissingIds = selected.filter(
    (id) => !packs.find((pack) => pack.id === id)?.installed,
  );
  const selectedInstalledPacks = packs.filter(
    (pack) => pack.installed && selected.includes(pack.id),
  );

  const refresh = async (scan = false) => {
    const result = scan
      ? await window.electronAPI.refreshModelPacks()
      : await window.electronAPI.getModelPacks();
    setPacks(result as ModelPack[]);
  };

  useEffect(() => {
    void refresh();
    let mounted = true;
    let receivedLiveProgress = false;
    window.electronAPI.onModelPackProgress((data) => {
      receivedLiveProgress = true;
      if (mounted) {
        setProgress(data);
        if (data.status === "error" && data.packId) {
          setFailedPackId(data.packId);
          setSelected((current) =>
            current.filter((value) => value !== data.packId),
          );
        }
      }
    });
    void window.electronAPI.getModelPackProgress().then((current) => {
      if (mounted && !receivedLiveProgress && current) {
        setProgress(current);
      }
    });
    return () => {
      mounted = false;
      window.electronAPI.removeModelPackProgress();
    };
  }, []);

  const toggle = (id: string) => {
    if (busy) return;
    if (failedPackId === id) setFailedPackId(null);
    if (progress?.status === "error") setProgress(null);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  };

  const downloadSelected = async () => {
    if (!selectedMissingIds.length) return;
    const downloadIds = selectedMissingIds;
    const attemptedPackId = downloadIds[0] ?? null;
    setError(null);
    setFailedPackId(null);
    setOperationActive(true);
    setProgress({
      status: "preparing",
      packId: null,
      packName: null,
      packIndex: null,
      packCount: null,
      message: null,
      transfer: null,
    });
    try {
      const complete = await window.electronAPI.downloadModelPacks(downloadIds);
      await refresh();
      await refreshAfterModelPackMutation();
      setSelected((current) =>
        current.filter((id) => !downloadIds.includes(id)),
      );
      if (complete) {
        setProgress(null);
        onContinue?.();
      }
    } catch (reason) {
      setFailedPackId(attemptedPackId);
      setSelected((current) =>
        current.filter((value) => value !== attemptedPackId),
      );
      setProgress((current) => ({
        status: "error",
        packId: current?.packId ?? attemptedPackId,
        packName: current?.packName ?? null,
        packIndex: current?.packIndex ?? null,
        packCount: current?.packCount ?? null,
        message: current?.message ?? null,
        transfer: current?.transfer ?? null,
      }));
      setError(
        reason instanceof Error ? reason.message : "Model download failed.",
      );
    } finally {
      setOperationActive(false);
    }
  };

  const removeSelected = async () => {
    const packsToRemove = selectedInstalledPacks;
    if (
      busy ||
      !packsToRemove.length ||
      !window.confirm(
        packsToRemove.length === 1
          ? `Remove ${packsToRemove[0].name}? Files shared with another model pack will be kept.`
          : `Remove ${packsToRemove.length} selected model packs? Files shared between packs will be kept.`,
      )
    ) {
      return;
    }
    setError(null);
    const removedIds: string[] = [];
    try {
      for (const pack of packsToRemove) {
        setDeleting(pack.id);
        await window.electronAPI.deleteModelPack(pack.id);
        removedIds.push(pack.id);
      }
      await refresh();
      await refreshAfterModelPackMutation();
      setSelected((current) =>
        current.filter((id) => !removedIds.includes(id)),
      );
    } catch (reason) {
      setSelected((current) =>
        current.filter((id) => !removedIds.includes(id)),
      );
      void refresh().catch(() => undefined);
      void refreshAfterModelPackMutation();
      setError(
        reason instanceof Error ? reason.message : "Model-pack deletion failed.",
      );
    } finally {
      setDeleting(null);
    }
  };

  const getPackState = (pack: ModelPack) => {
    const checked = selected.includes(pack.id);
    const matchesProgress =
      progress?.packId === pack.id ||
      (progress?.packName !== null && progress?.packName === pack.name);
    const active =
      downloading &&
      (matchesProgress ||
        (progress?.status === "preparing" &&
          progress.packId === null &&
          selectedMissingIds[0] === pack.id));
    const failed =
      !pack.installed &&
      (failedPackId === pack.id ||
        (progress?.status === "error" && matchesProgress));
    const transfer = active ? progress?.transfer : null;
    const percent = clampPercent(transfer?.percent);
    const speed = formatTransferRate(transfer?.speedBps);
    const eta = formatEta(transfer?.etaSeconds);
    const activeText = active
      ? [speed, eta ? `ETA ${eta}` : ""].filter(Boolean).join(" · ") ||
        "Preparing"
      : null;
    const statusName = active
      ? "Downloading"
      : checked
        ? "Selected"
        : pack.installed
          ? "Available"
          : failed
            ? "Failed"
            : "Missing";
    return {
      checked,
      active,
      failed,
      transfer,
      percent,
      activeText,
      statusName,
    };
  };
  const filteredPacks = packs.filter(
    (pack) =>
      (mediaFilter === "all" || pack.mediaTypes?.includes(mediaFilter)) &&
      (featureFilters.length === 0 ||
        featureFilters.some((feature) => pack.features?.includes(feature))),
  );
  const packGroups = groupModelPacks(filteredPacks);

  return (
    <div className={firstRun ? "w-full max-w-3xl" : "space-y-4"}>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-foreground">Model Manager</h3>
            <Button
              variant="outline"
              className="h-8 border-border-strong px-2.5 text-xs"
              disabled={busy}
              onClick={() => {
                setError(null);
                setChecking(true);
                void (async () => {
                  await refresh(true);
                  await refreshAfterModelPackMutation();
                })()
                  .catch((reason: unknown) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Model check failed.",
                    ),
                  )
                  .finally(() => setChecking(false));
              }}
            >
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
          {selected.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {selected.length} selected
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Shared files are skipped automatically, so estimated sizes can be
          smaller when another pack is already installed.
        </p>
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground"
          aria-label="Model status key"
        >
          {[
            ["Available", "bg-emerald-500"],
            ["Failed", "bg-red-500"],
            ["Missing", "bg-zinc-500"],
            ["Selected", "bg-blue-500"],
            ["Downloading", "bg-amber-400"],
          ].map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${color}`}
                aria-hidden="true"
              />
              {label}
            </span>
          ))}
        </div>
        <div className="mt-3 space-y-2 border-t border-border pt-3" aria-label="Model filters">
          <div className="flex flex-wrap gap-1.5">
            {(["all", "image", "video", "audio"] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={mediaFilter === filter}
                onClick={() => setMediaFilter(filter)}
                className={`rounded-full border px-2.5 py-1 text-2xs capitalize transition-colors ${
                  mediaFilter === filter
                    ? "border-blue-400 bg-blue-500/20 text-blue-100"
                    : "border-border text-muted-foreground hover:border-border-strong"
                }`}
              >
                {filter === "all" ? "All models" : `${filter} models`}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["generate", "edit", "reframe", "region"].map((feature) => (
              <button
                key={feature}
                type="button"
                aria-pressed={featureFilters.includes(feature)}
                onClick={() =>
                  setFeatureFilters((current) =>
                    current.includes(feature)
                      ? current.filter((value) => value !== feature)
                      : [...current, feature],
                  )
                }
                className={`rounded-full border px-2.5 py-1 text-2xs capitalize transition-colors ${
                  featureFilters.includes(feature)
                    ? "border-violet-400 bg-violet-500/20 text-violet-100"
                    : "border-border text-muted-foreground hover:border-border-strong"
                }`}
              >
                {feature}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {packGroups.map((group) => {
          const entries = group.packs.map((pack) => ({
            pack,
            state: getPackState(pack),
          }));
          const activeEntry = entries.find(({ state }) => state.active);
          const groupFailed = entries.some(({ state }) => state.failed);
          const groupChecked = entries.some(({ state }) => state.checked);
          const groupInstalled = entries.some(({ pack }) => pack.installed);

          if (group.grouped) {
            const stateClasses = activeEntry
              ? "border-amber-400 bg-amber-950/30"
              : groupChecked
                ? "border-blue-500 bg-blue-500/20"
                : groupFailed
                  ? "border-red-500 bg-red-500/15"
                  : groupInstalled
                    ? "border-emerald-500 bg-emerald-500/15"
                    : "border-border bg-input";
            const percent = activeEntry?.state.percent ?? null;

            return (
              <section
                key={group.id}
                className={`relative min-h-20 overflow-hidden rounded-xl border-2 px-4 py-3 transition-colors ${stateClasses}`}
                role={activeEntry ? "progressbar" : undefined}
                aria-valuenow={
                  activeEntry && percent !== null ? percent : undefined
                }
                aria-valuemin={activeEntry ? 0 : undefined}
                aria-valuemax={activeEntry ? 100 : undefined}
              >
                {activeEntry && (
                  <div
                    className={`absolute inset-y-0 left-0 bg-amber-400/20 transition-[width] ${percent === null ? "w-1/3 animate-pulse" : ""}`}
                    style={
                      percent === null ? undefined : { width: `${percent}%` }
                    }
                  />
                )}
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <h4 className="truncate text-sm font-medium text-foreground">
                    {group.name}
                  </h4>
                  {activeEntry && (
                    <span className="shrink-0 text-xs text-amber-300">
                      {activeEntry.state.activeText}
                    </span>
                  )}
                </div>
                <div className="relative z-10 mt-2 flex flex-wrap gap-2">
                  {entries.map(({ pack, state }) => {
                    const chipClasses = state.active
                      ? "border-amber-300 bg-amber-400 text-zinc-950"
                      : state.checked
                        ? "border-blue-300 bg-blue-500 text-white"
                        : pack.installed
                          ? "border-emerald-300 bg-emerald-400 text-zinc-950"
                          : state.failed
                            ? "border-red-300 bg-red-500 text-white"
                            : "border-border-strong bg-card text-muted-foreground hover:border-border";
                    const variantName = pack.variantName ?? pack.name;

                    return (
                      <button
                        key={pack.id}
                        type="button"
                        onClick={() => toggle(pack.id)}
                        disabled={busy}
                        aria-label={`${state.checked ? "Deselect" : "Select"} ${pack.name} (${state.statusName})`}
                        aria-pressed={state.checked}
                        title={`${pack.name}: ${state.statusName}`}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${chipClasses}`}
                      >
                        <span
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-current ${state.active ? "animate-pulse" : ""}`}
                          aria-hidden="true"
                        >
                          {(state.checked || state.active) && (
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          )}
                        </span>
                        <span aria-hidden="true">
                          {variantName} {pack.estimatedSize}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {activeEntry?.state.transfer?.filename && (
                  <p className="relative z-10 mt-2 truncate text-xs text-amber-300/80">
                    {activeEntry.state.transfer.filename}
                  </p>
                )}
              </section>
            );
          }

          const { pack, state } = entries[0];
          const stateClasses = state.active
            ? "border-amber-400 bg-amber-950/30"
            : state.checked
              ? "border-blue-500 bg-blue-500/20"
              : pack.installed
                ? "border-emerald-500 bg-emerald-500/15"
                : state.failed
                  ? "border-red-500 bg-red-500/15 hover:bg-red-500/20"
                  : "border-border bg-input hover:border-border-strong";
          return (
            <div
              key={pack.id}
              className={`relative min-h-20 overflow-hidden rounded-xl border-2 transition-colors ${stateClasses}`}
              role={state.active ? "progressbar" : undefined}
              aria-valuenow={
                state.active && state.percent !== null
                  ? state.percent
                  : undefined
              }
              aria-valuemin={state.active ? 0 : undefined}
              aria-valuemax={state.active ? 100 : undefined}
            >
              {state.active && (
                <div
                  className={`absolute inset-y-0 left-0 bg-amber-400/20 transition-[width] ${state.percent === null ? "w-1/3 animate-pulse" : ""}`}
                  style={
                    state.percent === null
                      ? undefined
                      : { width: `${state.percent}%` }
                  }
                />
              )}
              <button
                type="button"
                onClick={() => toggle(pack.id)}
                disabled={busy}
                aria-label={`${state.checked ? "Deselect" : "Select"} ${pack.name} (${state.statusName})`}
                aria-pressed={state.checked}
                className="relative z-10 flex min-h-20 w-full min-w-0 items-center justify-between gap-4 px-4 py-3 text-left disabled:cursor-default"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {pack.name}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {pack.estimatedSize}
                  </span>
                  {state.active && state.activeText && (
                    <span className="mt-1 block text-xs text-amber-300">
                      {state.activeText}
                    </span>
                  )}
                  {state.active && state.transfer?.filename && (
                    <span className="mt-1 block max-w-52 truncate text-xs text-amber-300/80">
                      {state.transfer.filename}
                    </span>
                  )}
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    state.active
                      ? "border-amber-300 text-amber-300"
                      : state.checked
                        ? "border-blue-300 text-blue-300"
                        : pack.installed
                          ? "border-emerald-400 text-emerald-400"
                          : state.failed
                            ? "border-red-400 text-red-400"
                            : "border-border-strong text-subtle-foreground"
                  } ${state.active ? "animate-pulse" : ""}`}
                  aria-hidden="true"
                >
                  {(state.checked || state.active) && (
                    <span className="h-2 w-2 rounded-full bg-current" />
                  )}
                </span>
              </button>
              {pack.licenseUrl ? (
                <a
                  href={pack.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="relative z-10 ml-4 mb-3 inline-block text-xs text-blue-300 hover:text-blue-200"
                >
                  View license
                </a>
              ) : null}
            </div>
          );
        })}
      </div>
      {packGroups.length === 0 && (
        <p className="text-sm text-muted-foreground">No models match these filters.</p>
      )}

      {progress?.status === "cancelled" && (
        <p className="mt-3 text-xs text-muted-foreground">
          {progress.message ?? "Download cancelled."}
        </p>
      )}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      <div className="mt-4 flex justify-end gap-2">
        {operationActive || downloading ? (
          <Button
            variant="outline"
            className="border-border-strong"
            onClick={() => void window.electronAPI.cancelModelPackDownload()}
          >
            <Square className="mr-2 h-3.5 w-3.5" /> Cancel download
          </Button>
        ) : (
          <>
            {firstRun && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={onContinue}
              >
                Skip for now
              </Button>
            )}
            <Button
              variant="outline"
              className="border-red-500/60 text-red-300 hover:bg-red-500/10 hover:text-red-200"
              disabled={busy || selectedInstalledPacks.length === 0}
              onClick={() => void removeSelected()}
            >
              Remove
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-500"
              disabled={busy || selectedMissingIds.length === 0}
              onClick={() => void downloadSelected()}
            >
              <Download className="mr-2 h-4 w-4" /> Download
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
