FeedX Jarvis standalone browser program — GPL-3.0, 2026-11-04
Upstream: https://github.com/shitoudaidi/GDDXX-Jarvis
Pinned: 7c36f0634005996b8d049569cb5ce8ee541f0671
Pilot checkpoint: 64c25823b94a2af1130dd5d65cf64383fe17e4f6

This independent program is distributed under GPL-3.0; see LICENSE.txt.
Third-party code/fonts retain their notices, see THIRD-PARTY-NOTICES.txt and vendor/.
The complete preferred editable source for THIS distributed browser program is
in source.zip alongside the running copy. HTML, CSS and JavaScript are served
unminified. Extract the archive and serve the directory with any static HTTP
server. For sandboxed embedding, set Access-Control-Allow-Origin:* for these
PUBLIC assets only. No build/install step, model, credential or proprietary FeedX
component is needed to modify or run the visual program. The import map resolves
vendored Three.js modules. Use standard HTTP; browsers may reject file:// modules.

Modifications: boot.js uses a reviewed allowlist and web.js instead of local
pilot transport; web.js adapts pilot UUID/request fencing and HUD state hooks to
a generic text-session JSON protocol with memory-only standalone fallback and controls;
web.css adds responsive conversation presentation; loop.js adds pause/visibility
suspension. Default original core.js/render.js shaders and animation math remain.
Browser assets are NOT imported into the FeedX proprietary React bundle; a
sandboxed iframe has an opaque origin, no credentials, cookies,
storage access, microphone, camera, tools or network transport. A documented
postMessage interface exchanges ordinary text/session/status data only. No shared
renderer internals or GPL imports exist in the proprietary host. See PROTOCOL.txt.
The HUD remains independently usable and modifiable. A process/iframe boundary
alone is not a legal determination about combined works; future intimate
integration requires renewed licence review.

No LLM answer, execution, stock data or voice response is simulated. Animated
idle visuals are decorative. Standalone mode has no services and memory-only history. When embedded in
canonical Staging, the host can supply authorized text sessions/results. Only
actual successful results become Assistant messages; STT/TTS/tools are unavailable.
The Python runtime is never exposed. Its bounded contract is adapted to one hosted
session authority, not a browser conversation engine. No credentials or auth
tokens cross the message boundary. Provider approval is independently required.
No film voice, non-commercial wake model, model weights or upstream plugins are
included or executed. No external demos or hardware hooks are loaded. This is
NOT an official Marvel product. Brand/character names belong to their owners.

Recipients retain GPL rights to run, inspect, modify and redistribute this HUD.
No FeedX proprietary licence or NDA is applied to these GPL program files.
