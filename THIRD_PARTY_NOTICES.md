# Third-party notices

## Bundled WanGP

AiVS releases include a filtered snapshot of official WanGP/Wan2GP source under the
WanGP Community License. First run copies this bundle into a writable, content-identified
user-data folder; it does not clone or update runtime source from the network.
The bundle retains WanGP's `LICENSE.txt` and in-tree component licence material,
including `THIRD_PARTY_NOTICES.md` and `LICENSES/` when supplied by the source.
Runtime and dependency licences are separate
from AiVS's Apache-2.0 licence and do not grant rights to optional model assets.

## MMAudio processor code

The bundled WanGP integration includes MMAudio processor code and vendored
Synchformer and BigVGAN components. Their licence texts ship with the bundled WanGP
source under `postprocessing/mmaudio/ext/` (including each component's
`incl_licenses/` directory). AiVS invokes the registered WanGP MMAudio processor locally
without adding a separate implementation.

## Optional MMAudio checkpoint assets

MMAudio processor assets are optional and are downloaded only through WanGP's
registered `DeepBeepMeep/Wan2.1` definitions (`mmaudio`,
`DFN5B-CLIP-ViT-H-14-378`, and `bigvgan_v2_44khz_128band_512x`). They are not
bundled with AiVS. The upstream repository does not currently declare a
repository-level weights licence, so AiVS records weights licensing and commercial
use as unknown and does not infer permission. Users must review and comply with any
terms supplied upstream at download time.
