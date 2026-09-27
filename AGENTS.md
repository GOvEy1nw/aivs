# AGENTS.md — AiVS Development Guide

This is the single project-wide instruction file for AI coding agents working on AiVS.

## 1. Authority and working branch

Use this order when information conflicts:

1. The user's current request and accepted task requirements.
2. This file for product guardrails and engineering rules.
3. The current source code, manifests, and configuration on the working branch.
4. Existing tests as evidence of important contracts, not as unquestionable product requirements.
5. README text, old comments, completed plans, and disabled placeholder UI.

`dev` is the normal working branch. Use another base only when the task explicitly says so.

Before editing:

- inspect the current branch and `git status`;
- understand the existing owner of the behaviour;
- preserve unrelated user changes;
- search for existing components, hooks, helpers, types, and services before creating anything new.

## 2. What AiVS is

AiVS is a local-first Electron desktop application for project-based AI image, video, and audio creation. It combines:

- **Quick Gen / GenSpace** for curated image, video, and audio workflows;
- **Director** for prompt- and frame-based generation planning;
- **Video Editor** for NLE-style editing;
- a shared local **Asset Library**;
- local runtime setup, model management, generation progress, cancellation, and recovery.

The primary platform is Windows with NVIDIA RTX hardware. Other platforms may support source development, but Windows behaviour and packaging must not be weakened incidentally.

## 3. Core product rules

These rules are non-negotiable unless the user explicitly changes the product direction.

### Local generation only

Normal generation must run on the user's machine through the local WanGP / Wan2GP runtime.

- Never send prompts, reference media, projects, or generated media to a hosted generation provider.
- Do not add a cloud fallback, hosted API, ComfyUI dependency, or second model runtime to bypass a missing WanGP feature.
- Network access is acceptable only for explicit supporting operations such as downloading models/runtime files, checking application updates, or opening a user-requested link.
- Do not add hidden telemetry or analytics.

### WanGP is the generation backend

WanGP / Wan2GP is the sole normal generation runtime.

- Product generation flows must go through the established backend handlers and `WanGPBridge`.
- AiVS may expose a feature only when there is a reliable WanGP path for it.
- Do not implement a separate direct inference pipeline inside the renderer, Electron main process, or backend.

### Curated, simple product surface

WanGP describes what is technically available; AiVS decides what is supported and visible.

- Product-visible models and capabilities are backend-owned curated profiles.
- Do not expose raw WanGP settings or discovered models directly in the UI.
- Prefer clear creative controls, sensible defaults, and progressive disclosure over technical configuration dumps.
- Disabled or placeholder UI is not an instruction to implement a feature.

### User-owned projects and media

Projects, settings, source media, and outputs remain under the user's control.

- Generated and imported media must integrate with project storage and the shared Asset Library where appropriate.
- Preserve project isolation, stable asset IDs, Copy Settings metadata, and reopen compatibility.
- File deletion and movement must remain constrained to approved roots and the owning project.

### Lean, maintainable implementation

Preserve proven behaviour, data, and security contracts, but do not preserve poor structure merely because it already exists.

- Prefer the smallest coherent change with a clear long-term owner.
- Refactor a bounded area when that genuinely removes duplication or confused ownership.
- Avoid speculative frameworks, generic form engines, wrapper layers, and abstractions with only one real consumer.
- Do not leave permanent parallel implementations, compatibility shims, `V2` components, or duplicated sources of truth.

## 4. Architecture at a glance

```text
React renderer (`frontend/`)
  ├─ authenticated HTTP through `backendFetch`
  │    └─ FastAPI backend (`backend/`)
  │         └─ handlers -> services/state -> WanGP bridge -> local Wan2GP
  │
  └─ typed `window.electronAPI`
       └─ context-isolated preload (`electron/preload.ts`)
            └─ Electron main / IPC (`electron/`)
                 ├─ project and file storage
                 ├─ native dialogs and approved paths
                 ├─ ffmpeg/export and frame extraction
                 ├─ Python/WanGP setup and supervision
                 └─ application lifecycle and updates
```

### Main folders

| Path | Responsibility |
| --- | --- |
| `frontend/` | React renderer, contexts, hooks, views, shared UI, media helpers, and frontend tests |
| `frontend/views/genspace/` | Quick Gen composition, controller hooks, shared controls, and image/video/audio mode UI |
| `frontend/hooks/generation/` | Shared generation request, progress, cancellation, and terminal-state lifecycle |
| `frontend/views/director/` | Director domain, preview, timeline, takes, and persistence |
| `frontend/views/editor/` | Video Editor domain, playback, timeline, inspector, and export-facing state |
| `frontend/components/` | App-wide reusable UI, Asset Library, settings, model selection, and menus |
| `frontend/contexts/` | Project, backend lifecycle, model profiles, app settings, and keyboard ownership |
| `shared/` | Types shared across renderer, preload, and Electron main, especially `ElectronAPI` |
| `electron/` | Desktop lifecycle, preload, IPC, path safety, storage, runtime setup, export, and packaging behaviour |
| `backend/` | FastAPI routes, typed handlers, state, services, curated profiles, WanGP bridge, and backend tests |
| `scripts/` | Supported setup, build, packaging, runtime-stack, and WanGP update workflows |
| external `Wan2GP/` source | Development executes `C:\Wan2GP` directly (overridable through `WANGP_ROOT` or `WANGP_WGP_PATH`). Releases bundle this independent source and copy it into writable user-data storage for execution; Git is not required for source selection. |
| `resources/` | Application and installer resources |
| `backlog/tasks/` | Actionable task scope, acceptance criteria, plans, status, and validation evidence |

## 5. Reuse before creating

Do not create a new control merely because copying markup is quicker. Search by purpose and behaviour, not only by the name you expect.

### Existing UI owners to check first

| Need | Existing owner(s) |
| --- | --- |
| Standard button | `frontend/components/ui/button.tsx` |
| Dropdown, popup, or anchored menu | `frontend/components/SettingsDropdown.tsx`, `frontend/components/FloatingMenu.tsx` |
| Model selection/download state | `ModelPicker.tsx`, `ModelDropdownTrigger.tsx`, `ModelDownloadButton.tsx` |
| Prompt box and prompt actions | `genspace/components/PromptEditor.tsx`, `PromptActions.tsx` |
| Generation panel structure | `GenPanelSection.tsx`, `GenerateButton.tsx` |
| Aspect ratio and framing | `AspectRatioDropdown.tsx`, `FramingControl.tsx` |
| Media input tile | `MediaInputSlot.tsx`, `CroppableMediaInputSlot.tsx` |
| Media role/actions menu | `MediaRoleMenu.tsx` |
| Composed image/video inputs | `ImageMediaInputs.tsx`, `ImageEditMediaInputs.tsx`, `VideoMediaInputs.tsx` |
| Shared project assets | `frontend/components/GalleryAssetLibrary.tsx` and its supporting gallery components |
| Logging and user-facing errors | existing renderer, Electron, and backend logging/error helpers |

Rules for reuse:

- Extend the existing typed API when the same control needs one more legitimate option.
- Compose existing primitives when a workflow is similar but not identical.
- Refactor the shared owner when multiple consumers need the same improvement.
- Do not fork near-identical dropdowns, prompt editors, media slots, asset grids, progress displays, or model selectors.
- Existing inline or legacy UI is not automatically a pattern to copy; prefer the shared primitive that now owns that behaviour.
- Do not force genuinely different domains into one oversized universal component. Share the stable primitive and keep domain logic with its owner.

## 6. Frontend rules

### Keep ownership clear

`GenSpaceWorkspace` composes the Quick Gen surface and `useGenSpaceController` owns its persistent state and orchestration.

Mode panels should mainly compose UI from typed controller contracts. They must not independently:

- create another project-state owner;
- call backend generation endpoints directly;
- persist generated assets;
- create another `useGeneration()` instance;
- add their own progress polling or cancellation loop.

Put:

- persistent workflow state and orchestration in focused controller hooks;
- pure request compilation, normalization, restoration, and transformations in `logic/` or focused pure modules;
- mode-specific presentation under `image/`, `video/`, `audio/`, or `music/`;
- genuinely cross-mode controls under `genspace/components/`.

### Use the shared generation lifecycle

`frontend/contexts/GenerationQueueContext.tsx` owns polling, cancellation, terminal-state handling, and project-scoped persistence. `frontend/hooks/use-generation.ts` owns draft submission and forwards cancellation to the queue context.

- Extend the shared lifecycle rather than creating a second job manager.
- Generation completion must use the immutable project-scoped submission snapshot, not whatever project or settings happen to be active later.
- Result persistence must be idempotent and must not save into a newly selected project.

### Respect app-level providers

Use existing project, backend lifecycle, model-profile, settings, and keyboard contexts. Do not add parallel app-wide polling or duplicate cached state.

Backend calls must use `frontend/lib/backend.ts` and `backendFetch()` so the Electron-provided URL and per-session token are preserved. Do not hard-code `localhost:8000`, create a second API client, or bypass authentication.

Model controls must consume the backend profile API. Do not hard-code a second frontend model registry.

### Preserve inactive workspace behaviour

`Project.tsx` keeps visited Quick Gen, Director, and Video Editor workspaces mounted so authored state survives tab changes.

An inactive workspace must stop or avoid:

- playback and transport shortcuts;
- media decoding/warming;
- visible compositor output;
- unnecessary polling, timers, and expensive effects.

Do not casually replace this with unmount/remount behaviour or remove the `isActive` contract.

### UI and styling

- Use the existing Tailwind theme, semantic tokens, spacing, and interaction patterns.
- Preserve keyboard access, labels, focus states, disabled explanations, progress states, and error states.
- Prefer direct imports over broad barrel files that hide ownership or create cycles.
- Keep strict TypeScript clean; do not use broad `any`, `@ts-ignore`, or unchecked casts to silence design problems.
- Comments should explain a non-obvious reason or constraint, not narrate the code.

## 7. Electron is the application runtime

AiVS is not a normal browser application.

- `pnpm dev` starts Vite through `vite-plugin-electron` and launches the Electron app.
- Do not open the Vite URL in a standalone browser and treat it as the application.
- Do not use browser rendering or browser automation as proof that Electron-only behaviour works.
- A browser does not provide the real preload bridge, native file paths, IPC, project storage, ffmpeg, media behaviour, runtime supervision, or packaged resource layout.
- Visual and interaction checks must be performed in the actual Electron window. Native file, drag/drop, playback, seeking, IPC, and packaging changes require an Electron smoke test.

### Security boundary

- Keep `contextIsolation: true`.
- Keep renderer `nodeIntegration: false`.
- Renderer code must not import Node or Electron APIs directly.
- Native capability must be exposed narrowly through the typed `ElectronAPI` contract.
- Never expose raw `ipcRenderer`, arbitrary shell execution, unrestricted filesystem access, or a generic unbounded invoke method.

When adding or changing native functionality, keep these aligned:

1. `shared/electron-api.ts`;
2. `electron/preload.ts`;
3. the appropriate domain handler under `electron/ipc/` or native helper under `electron/lib/`;
4. the renderer caller and its types.

Use `webUtils.getPathForFile(file)` through the preload bridge for dropped/selected files. Do not restore renderer `File.path` casts.

Validate and canonicalize paths before reading, copying, moving, deleting, or revealing files. Preserve project-root containment and approval rules.

## 8. Backend and WanGP rules

The backend flow is:

```text
backend/_routes/* -> AppHandler -> domain handler -> service/state -> WanGPBridge
```

### Routes

Routes are thin HTTP adapters. They should parse typed requests, call the composed handler, and return typed responses. Do not place business logic, model mapping, heavy file work, or WanGP orchestration in route modules.

### AppHandler and domain handlers

`backend/app_handler.py` is the composition root and shared state owner.

- Add behaviour to the handler that owns the domain.
- Do not create a second global state container or hidden singleton.
- Handlers own validation, state transitions, and orchestration.
- Services own heavy or external side effects.
- Use typed Pydantic models, dataclasses, protocols, and discriminated states at owned boundaries.
- Normalize loose WanGP data as early as practical.

### Locking and heavy work

The shared `RLock` protects state, not long-running work.

```text
lock -> validate/read/update state -> unlock
perform GPU, model, ffmpeg, download, or disk work
lock -> publish completion/error/cancellation -> unlock
```

Never hold the shared lock while loading models, generating, downloading, running ffmpeg, or doing other slow I/O.

### Curated profiles

`backend/model_profiles/profiles.py` is the product-facing source of truth for visible models and capabilities.

Adding a model normally requires coordinated profile policy, exact WanGP mapping/defaults, availability/model-pack behaviour, saved-setting compatibility, focused validation, and real-runtime testing. A WanGP model definition or downloaded checkpoint is not automatically an AiVS product profile.

### Runtime compatibility

Treat Python, Torch, CUDA, acceleration kernels, and WanGP as one curated compatibility unit.

- Use the versions and install paths pinned by `backend/pyproject.toml`, `backend/uv.lock`, `scripts/wangp-stacks.json`, and the repository scripts.
- Do not run broad `pip install -U`, generic `uv update`, or automated dependency upgrades across the GPU stack.
- Do not let a normal package update prune hardware-specific wheels from the shared backend environment.
- Development executes the independent `C:\Wan2GP` source directly. Release builds bundle its runtime files; installed builds copy that bundle into a writable folder identified by source content, without fetching or updating source at runtime.
- Use native WanGP model definitions. Do not inject AiVS finetunes or synthesize custom checkpoint definitions.

## 9. Persistence and file safety

- Default project storage is under the user's selected AiVS project root, normally `Documents/AiVS`.
- Imported project media belongs under `{projectId}/uploads/`.
- Completed generated media belongs under `{projectId}/generated/`.
- Runtime executables, model caches, updater state, temporary outputs, and logs do not belong in project folders.
- Preserve stable project/asset IDs and resolve live paths at native or request boundaries.
- Keep duplicate handling, move/copy behaviour, and deletion policy in the existing native project-asset helpers.
- Any persisted schema change needs an explicit compatibility path for existing projects. Migration must be idempotent and recoverable.
- Never silently reinterpret old project data or discard unknown fields without a deliberate migration.

Do not commit model weights, generated media, backend virtual environments, bootstraps, caches, logs, `release/`, `dist/`, or other generated artifacts unless the task explicitly requires a small tracked fixture.

## 10. Dependencies and code shape

- Use the Node and pnpm versions declared in `package.json`; currently Node 24 and pnpm 10.30.3.
- Use pnpm only. Do not introduce npm/yarn lockfiles or package-manager metadata.
- Use `uv` and the repository-managed backend environment for Python.
- Add a dependency only when existing platform or project utilities cannot solve the problem cleanly.
- Keep dependency upgrades separate from features and refactors unless the upgrade is strictly required.
- Keep functions, hooks, components, handlers, and services focused around one clear responsibility.
- Prefer explicit domain types and discriminated unions over flag-heavy objects with impossible states.
- Delete dead code, superseded adapters, stale flags, and duplicate helpers when a migration completes.
- Avoid opportunistic formatting churn or unrelated cleanup in a focused change.

## 11. Lean testing policy

The default is not “add a test for every change.” The default is “protect stable contracts whose failure would be costly, dangerous, or difficult to notice.”

### Add or retain automated tests for

- security, path containment, file approval, and destructive IPC behaviour;
- project persistence, migrations, project isolation, and idempotent result saving;
- generation request compilation, curated-profile validation, and important WanGP mappings;
- cancellation, progress, terminal-state, submission-snapshot, and recovery behaviour;
- complex Director/editor timeline math or deterministic media transformations;
- a confirmed regression with meaningful user impact and a stable assertion.

Prefer pure logic tests and backend integration tests with lightweight fakes at heavy WanGP/process boundaries.

### Do not add brittle tests for

- exact wording, punctuation, placeholders, or labels unless the text is itself a contractual error/code;
- exact pixel sizes, spacing, Tailwind class strings, element positions, wrapper counts, or DOM structure;
- the precise order of ordinary controls when order is not functional;
- implementation details such as internal hook calls or local state shape;
- broad snapshots of components or pages;
- every visual variant or trivial getter/setter;
- browser-only simulations of Electron-native behaviour.

When a harmless UI edit breaks an existing test that only mirrors markup or copy, simplify or remove that brittle assertion rather than teaching it the new markup.

### Run the narrowest useful validation

| Change | Minimum useful validation |
| --- | --- |
| Markdown/comments only | Review the full diff; no application tests |
| Copy, CSS, spacing, or layout | Typecheck if TS changed, `pnpm build:frontend`, then visual smoke in Electron; no new test |
| Frontend logic or meaningful interaction | `pnpm typecheck:ts`; run one focused Vitest file only when a critical stable contract is affected |
| Frontend composition/import/preload type change | `pnpm typecheck:ts` and `pnpm build:frontend`; focused test only if justified |
| Backend domain logic | `pnpm typecheck:py`; focused pytest for the changed critical contract |
| Shared backend state/API/profile/WanGP bridge | Focused pytest plus the broader backend suite when risk warrants it |
| IPC, preload, paths, or native files | Typecheck/build, focused safety test where applicable, and an Electron smoke test |
| Packaging, bootstrap, resources, updater, or installer | Unpacked Windows build; full installer only when installer/release behaviour is in scope |
| Broad/high-risk PR or release candidate | Full relevant frontend/backend suites and packaged-app smoke paths |

Never claim a check passed unless it ran successfully in the current worktree. Report skipped or blocked checks plainly.

## 12. Common commands

Run commands from the repository root unless shown otherwise.

### Setup and development

| Command | Purpose |
| --- | --- |
| `corepack enable` | Make the pinned pnpm available through Corepack |
| `pnpm install --frozen-lockfile` | Install exact frontend/desktop dependencies without changing the lockfile |
| `pnpm setup:dev:win` | Prepare the Windows development environment, WanGP checkout, backend venv, and GPU stack |
| `pnpm dev` | Launch Vite, Electron, and the supervised local backend |
| `pnpm dev:debug` | Launch with Electron inspector and Python debug support |

Development executes `C:\Wan2GP` directly. `setup:dev:win` validates it and prepares the backend environment; it does not require Git history or clone source.

```powershell
$env:WANGP_ROOT = "D:\Wan2GP"
pnpm setup:dev:win
```

The setup scripts never fetch, switch, or patch this checkout. WanGP itself may write its normal runtime files when executed.

### Focused checks

| Command | Purpose |
| --- | --- |
| `pnpm typecheck:ts` | Strict TypeScript check |
| `pnpm typecheck:py` | Pyright check for the backend |
| `pnpm typecheck` | Run both typecheck layers |
| `pnpm test:frontend -- path/to/file.test.tsx` | Run one focused Vitest file |
| `pnpm build:frontend` | Build renderer, Electron main, and preload bundles |
| `pnpm check:package-manager` | Verify the expected package-manager setup |
| `pnpm test:media-import` | Run the focused project asset import check |

Focused backend test:

```powershell
cd backend
uv run pytest tests/test_relevant_feature.py -q
```

Full gates—use deliberately, not after every small edit:

| Command | Purpose |
| --- | --- |
| `pnpm test:frontend` | Full frontend Vitest suite |
| `pnpm validate:frontend` | TypeScript, full frontend tests, and production bundle |
| `pnpm backend:test` | Sync frozen backend test/dev dependencies and run the full pytest suite |

### Windows builds

| Command | Purpose |
| --- | --- |
| `pnpm build:frontend` | Bundle code only; this is not a complete desktop package |
| `pnpm build:fast:win` | Build an unpacked Windows app using existing Python/Git bootstraps |
| `pnpm start:unpacked:win` | Launch the current unpacked build |
| `pnpm build:win:skip-python` | Build the installer while reusing the existing Python bootstrap |
| `pnpm build:win` | Run the supported full Windows installer build workflow |

Use the repository build scripts. Do not replace them with ad hoc `vite`, raw `electron-builder`, or hand-copied packaging steps. A successful frontend bundle does not prove that preload paths, bundled resources, Python, WanGP, or the installer work.

### WanGP source/runtime maintenance

| Command | Purpose |
| --- | --- |
| `pnpm wangp:check` | Inspect the external WanGP development source without modifying it |
| `pnpm wangp:validate` | Run focused compatibility validation against the external checkout without modifying it |
| `pnpm wangp:validate:full` | Run the full external-checkout validation gate without modifying it |

## 13. Working style

- Keep one task and one coherent concern in scope.
- Use an active Backlog task when one exists; keep detailed plans, acceptance criteria, status, and validation evidence there rather than creating more project-wide documents.
- Do not silently implement useful-but-unrequested extras. Record them separately.
- Separate feature work, architecture refactors, dependency upgrades, runtime changes, and visual redesigns when combining them would obscure review.
- Prefer small reviewable commits with descriptive intent.
- Preserve existing user-visible behaviour unless the task explicitly changes it.
- For a substantial refactor, identify the stable boundary, callers, persisted contracts, cut-over, and old code to remove before starting destructive changes.

## 14. Definition of done

A change is complete when all applicable statements are true:

- The requested behaviour is implemented without unrelated scope expansion.
- Local-only, WanGP-only generation and user-data boundaries remain intact.
- Existing shared components and owners were reused or deliberately improved instead of duplicated.
- Renderer, preload, Electron, backend, and model-profile responsibilities remain in the correct layer.
- Project persistence, result ownership, cancellation, progress, and error recovery remain correct where affected.
- Existing saved projects/settings are preserved or explicitly migrated.
- Only valuable, stable tests were added or retained; brittle tests were not introduced.
- The narrowest sufficient checks ran and their actual results are reported.
- Electron-native behaviour was checked in Electron when relevant.
- Packaging was checked when preload, resources, setup, updater, or filesystem layout changed.
- Dead code and temporary migration scaffolding were removed when no longer needed.
- The final diff contains no generated artifacts, accidental lockfile changes, stale imports, unrelated formatting churn, or duplicated documentation.

## 15. Maintaining this file

Update `AGENTS.md` only when a core product rule, architectural owner, supported workflow, build command, runtime contract, or engineering policy changes.

Keep it concise and current. Do not append task history, feature roadmaps, completed implementation narratives, test transcripts, or temporary warnings.
