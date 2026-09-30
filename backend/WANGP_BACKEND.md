# WanGP Backend Bridge

This backend runs `/api/generate` and `/api/generate-image` through the independent `C:\Wan2GP` source and its in-process Python API.

## Source and updates

Development executes `C:\Wan2GP` directly, without requiring Git history. Release builds
bundle its runtime code and native definitions, excluding local finetunes and caches.
Installed builds copy that source into a writable user-data folder identified by bundle
content because WanGP writes beside its source. There is no runtime
Git cloning, source update, custom-definition deployment or rollback manager.

Official Wan2GP preview compatibility is validated against upstream commit
`eb0362f0a87f3d5288faa60a1c2bf97f27d32b1f` (WanGP 13.14), requiring MMGP 3.8.2.
The release snapshot remains identified by its source-content hash; this revision
is the tested baseline, not an automatic source updater or Git requirement.

Use `pnpm wangp:check` to inspect the external development source without
changing it. `pnpm wangp:validate` additionally runs a static, no-import contract
check for the session API, enhancer signature, curated default files, and native
profile binding files, followed by focused source tests. It does not download
models or execute GPU work. `pnpm wangp:validate:full` adds the existing type and
frontend build checks; an installed-model application smoke remains separate.

## Required

- `WANGP_ROOT`
  - Optional external WanGP source override; otherwise `C:\Wan2GP` is used. It must contain
    `wgp.py`, `shared/api.py`, and `requirements.txt`.
  - `WANGP_WGP_PATH` remains a compatibility alternative when `WANGP_ROOT` is unset.

## Optional

- `WANGP_VIDEO_MODEL_TYPE`
  - Defaults to `ltx2_25_22B_distilled`.
- `WANGP_IMAGE_MODEL_TYPE`
  - Defaults to `z_image`.
- `WANGP_EXTRA_ARGS`
  - Extra WanGP startup flags passed into `shared.api.WanGPSession`.
  - Example: `--attention sdpa --profile 4`

## Environment Note

- The AiVS backend interpreter imports the selected source directly and executes WanGP
  in-process through `shared.api.WanGPSession`.
- Do not modify, switch, or deploy AiVS definitions into the external checkout.
- Model selection resolves to native WanGP definitions. AiVS custom finetunes and checkpoint
  overrides are unsupported; old saved settings remain inert and checkpoint files are not deleted.

## Behavior

- Video requests are translated into single-task WanGP manifests and executed through `shared.api.WanGPSession`.
- Curated accelerator and preset IDs resolve through AiVS's exact stable binding catalog.
  The resolver reads native defaults and `get_model_settings(...)["content"]`, then uses
  WanGP's native LoRA merge and settings-fix helpers. Raw native selectors and discovered
  model settings are not product-facing IDs.
- AiVS model packs and selected style LoRAs use WanGP's native download APIs. Native `gen`
  download callbacks provide transfer progress and cancellation; no secondary downloader or
  model runtime is used.
- Image/video clients send semantic `enhancePrompt`; backend owns WanGP's raw `prompt_enhancer` value. Disabled sends `""`. Enabled text-only sends `"T"`; enhancer-visible start/end/reference images add `I`; relay shot prompts add `1`. This yields `T`, `TI`, `T1`, or `TI1`. Control guides and Continue Video sources do not count as enhancer-visible images. Profile defaults are always overridden, including Region's forced disabled state.
- Curated Video Tools use the typed `videoTool` request field. Extend keeps the existing `continue_video` path; Relight, Colorize, Clean Plate, Lip Dub, Decompression, SDR to HDR, Remove Glare, and Deblur map to backend-owned exact IC-LoRA URLs with guide-only input, `guidance_phases=2`, and an empty LoRA multiplier. Unknown tool IDs are rejected before WanGP execution.
- LTX video submissions clear the WanGP `config` value at the shared bridge boundary.
- Image requests use the same mechanism with the configured image model.
- ACE-Step song-description enhancement remains LM CoT through `model_mode`: manual/off `1`, manual/on `2`, auto-duration/off `4`, and auto-duration/on `3`. Auto Lyrics passes the song description as lyrics context with `prompt_enhancer="T"`; Instrumental and Custom Lyrics send `""`. Empty Custom Lyrics is rejected, while `/api/music/compose-lyrics` remains a separate editable pre-generation operation.
- Progress comes from WanGP's native generation events and native download callbacks, with
  stdout/stderr also streamed into the bridge.
- AiVS saves the native `generation_preview` modes `rgb`, `tiny_vae_frames`, and `tiny_vae_video`,
  producing still images for image jobs and MP4 previews for supported video jobs.
  with Tiny VAE video as the default. Legacy TAE settings migrate to `tiny_vae_video`;
  Off and unsupported values migrate to RGB with a dismissible settings notice. Mode changes
  unload the cached model before the next
  generation so its decoder is rebuilt with the selected mode.
- WanGP owns TinyVAE selection, automatic decoder downloads, fallback and tuning.
  Legacy preview device, update rate, size, FPS and quality fields are removed during
  stored-settings migration; current API writes accept only the native mode.
  AiVS consumes native `PreviewUpdate.image` and `.video`; queue updates retain the
  latest preview until another arrives. No fork-specific decoder installer is needed.
- Cancel requests signal the active WanGP model directly instead of terminating a subprocess.
- LTX Desktop first-run "download" becomes a no-op when the bridge is enabled, because model management is delegated to WanGP.
