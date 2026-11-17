// Explicit beta entry point. The legacy module remains importable for tests
// and tooling, but the public beta opts into the v5 presentation path here.
import { startP2PCausalBeta } from "./p2p-causal-beta.js";
import { createCausalBetaPresentationRenderer } from "./p2p-causal-beta-renderer.js";
import { createP2PWasmCausalAudioPresenter } from "../tools/wasm-spike/p2p-wasm-causal-audio.mjs";
import { startP2POfflinePractice } from "./p2p-offline-practice.js";

let practice = null;
// One mixer/presenter is shared by the visible offline practice and the
// online causal session. The menu's trusted gesture must unlock the audio
// stream that is actually presenting the current arena, not a second hidden
// mixer created by the room controller.
const audioPresenter = createP2PWasmCausalAudioPresenter();
const startPractice = () => {
  if (practice?.isRunning?.()) return practice;
  practice = startP2POfflinePractice({
    presentationRendererFactory: ({ canvas, role }) => createCausalBetaPresentationRenderer({ canvas, role }),
    audioPresenter,
    disposeAudioPresenter: false,
  });
  return practice;
};
const showPracticeStatus = () => {
  const title = document.getElementById("arena-title");
  const status = document.getElementById("causal-state");
  const overlay = document.getElementById("renderer-loading-overlay");
  if (title) title.textContent = "Entrenamiento libre";
  if (status) status.textContent = "Práctica local · Nitro infinito · Abre Menú para crear o unirte a una sala privada.";
  if (overlay) overlay.hidden = true;
};
startPractice();

// Every private mode uses the same arena-first room flow. This preserves the
// freely playable practice while friends arrive, then lets the host start the
// authoritative round explicitly instead of auto-starting a legacy 1v1.
const matchMode = document.getElementById("match-mode");
const unifiedCreate = document.getElementById("unified-create");
const unifiedJoin = document.getElementById("unified-join");
const roomCodeInput = document.getElementById("room-code");
const playerNameInput = document.getElementById("player-name");
const normalizedOnlineName = () => String(playerNameInput?.value || "").replace(/\s+/gu, " ").trim().slice(0, 16);
const updateUnifiedActionAvailability = () => {
  if (unifiedCreate) unifiedCreate.disabled = !normalizedOnlineName();
  if (unifiedJoin) unifiedJoin.disabled = !normalizedOnlineName() || !String(roomCodeInput?.value || "").trim();
};
const openMultiRoom = ({ roomCode = null } = {}) => {
  if (!normalizedOnlineName()) { playerNameInput?.focus?.(); return; }
  const mode = matchMode?.value || "2v2";
  const href = new URL("/p2p-multiplayer.html", location.origin);
  href.searchParams.set("mode", mode);
  const name = document.getElementById("player-name")?.value?.trim();
  if (name) href.searchParams.set("name", name.slice(0, 32));
  if (roomCode) href.searchParams.set("join", roomCode);
  else href.searchParams.set("create", "1");
  location.assign(href.href);
};
unifiedCreate?.addEventListener("click", () => {
  openMultiRoom();
});
unifiedJoin?.addEventListener("click", () => {
  if (!normalizedOnlineName()) { playerNameInput?.focus?.(); return; }
  const roomCode = roomCodeInput?.value?.trim();
  if (!roomCode) { roomCodeInput?.focus(); return; }
  openMultiRoom({ roomCode });
});
playerNameInput?.addEventListener("input", updateUnifiedActionAvailability);
roomCodeInput?.addEventListener("input", updateUnifiedActionAvailability);
updateUnifiedActionAvailability();

startP2PCausalBeta({
  presentation: true,
  presentationCanvas: document.getElementById("causal-scene"),
  presentationRendererFactory: ({ canvas, role }) => createCausalBetaPresentationRenderer({ canvas, role }),
  audioPresenter,
  onBeforeOnlinePresentationStart: () => {
    // The causal snapshot that activates the live Three.js renderer is the
    // exact handoff point. Until then the player keeps their local WASM
    // practice arena, including throughout room creation and NAT setup.
    practice?.stop();
    practice = null;
    const title = document.getElementById("arena-title");
    if (title) title.textContent = "Arena privada 1v1";
  },
  onOnlineSessionEvent: event => {
    // Keep the free-drive visible while a host waits for an invitee. Only an
    // actual causal channel replaces the local authority, avoiding a blank
    // arena during room creation or NAT negotiation.
    // Leaving, expiry or a direct-connection failure must return the player
    // to an immediately playable arena instead of a black waiting screen.
    if (event?.type === "closed" || event?.type === "peer-left" || event?.type === "error" || event?.type === "presentation-error") {
      showPracticeStatus();
      startPractice();
    }
  },
});
// bootP2PRoomLobby restores the saved name synchronously. Refresh the visible
// gates after that restore so a valid saved identity can create a room without
// briefly remaining disabled.
updateUnifiedActionAvailability();
