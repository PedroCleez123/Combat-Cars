import {
  P2P_ICE_SERVERS,
  P2P_SIGNAL_ORIGIN,
  isP2PIceConnectionState,
} from "./p2p-room-config.js";
import {
  P2PSignalingClient,
  consumeP2PInviteFragment,
  createP2PInviteUrl,
  restoreP2PInvite,
} from "./p2p-signaling-client.js";
import { P2PWebRTCSession } from "./p2p-webrtc-session.js";
import { normalizeP2PPlayerName } from "./p2p-player-identity.js";

export const P2P_ROOM_LIFECYCLE_LABELS = Object.freeze({
  waitingOpponent: "Esperando rival…",
  negotiating: "Negociando la conexión…",
  channelReady: "Canal listo; esperando el primer estado.",
  active: "Partida activa.",
  waitingReplacement: "Rival desconectado; esperando reemplazo.",
  hostLeft: "El anfitrión abandonó la sala.",
  error: "No se pudo conectar directamente. La red, el firewall o el NAT pueden bloquear WebRTC. Pulsa Reintentar.",
});

export const P2P_ROOM_ERROR_MESSAGES = Object.freeze({
  direct: P2P_ROOM_LIFECYCLE_LABELS.error,
  create: "No se pudo crear la sala. Comprueba la conexión y pulsa Reintentar.",
});

export function p2pRoomLifecycleLabel(state) {
  return P2P_ROOM_LIFECYCLE_LABELS[state] || P2P_ROOM_LIFECYCLE_LABELS.error;
}

export function initializeP2PRoomLobby({
  documentRef = document,
  locationRef = location,
  historyRef = history,
  storage = sessionStorage,
  localStorageRef = localStorage,
  origin = P2P_SIGNAL_ORIGIN,
  iceServers = P2P_ICE_SERVERS,
  Client = P2PSignalingClient,
  WebRTCSession = P2PWebRTCSession,
  CausalRoomSession = null,
  causalContextFactory = null,
  hostFactory = null,
  causalHostFactory = null,
  onCausalSnapshot = () => {},
  onMetadata = () => {},
  onPeerIdentity = () => {},
  onSessionEvent = () => {},
  presentation = false,
  primePilotOnWelcome = false,
  metadata = false,
  now = () => Date.now(),
} = {}) {
  const status = documentRef.getElementById("status");
  const primary = documentRef.getElementById("primary");
  const roomPanel = documentRef.getElementById("room-panel");
  const inviteInput = documentRef.getElementById("invite-url");
  const roomCaption = documentRef.getElementById("room-caption");
  const roomCodeDisplay = documentRef.getElementById("room-code-display");
  const roomCodeValue = documentRef.getElementById("room-code-value");
  const copyRoomCode = documentRef.getElementById("copy-room-code");
  const roomCodeInput = documentRef.getElementById("room-code");
  // The compact beta menu has a single visible join button. Keep the legacy
  // id for the standalone lobby, but bind the unified control when that is the
  // only one present so the short-code path cannot silently do nothing.
  const unifiedJoin = documentRef.getElementById("unified-join");
  const joinRoomCode = documentRef.getElementById("join-room-code") || unifiedJoin;
  const roomCodeStatus = documentRef.getElementById("room-code-status");
  const inviteNote = documentRef.getElementById("invite-note");
  const nameInput = documentRef.getElementById("player-name");
  const notice = documentRef.querySelector?.(".notice");
  const roomResult = consumeP2PInviteFragment({ hash: locationRef.hash, storage, now });
  if (roomResult.recognized) historyRef.replaceState(null, "", `${locationRef.pathname}${locationRef.search}`);
  const invite = roomResult.invite || restoreP2PInvite({ storage, now });
  const client = new Client({ origin, now });
  const canStartRoom = () => Boolean(client.origin);
  let activeRoom = null;
  let session = null;
  let sessionAttempted = false;
  let sessionFailed = false;
  let peerReady = false;
  // After the ordered WebRTC channel opens, signaling is no longer part of
  // the match path. Keep this separate from the lobby lifecycle so a later
  // Worker/WebSocket interruption cannot evict a healthy direct session.
  let directChannelReady = false;
  let causalContext = null;
  let lifecycleState = null;
  // Retain only the already-held, short-lived room credentials needed for a
  // deliberate retry. They never leave the browser or enter the causal
  // protocol. This is separate from activeRoom because P2PSignalingClient
  // clears its live credentials whenever a socket closes.
  let retryRoom = null;
  let reconnecting = false;

  const causalEnabled = typeof CausalRoomSession === "function";
  if (typeof onCausalSnapshot !== "function") throw new TypeError("El observador de snapshots causales debe ser una función.");
  if (typeof onMetadata !== "function") throw new TypeError("El observador de metadatos causales debe ser una función.");
  if (typeof onPeerIdentity !== "function") throw new TypeError("El observador de identidad P2P debe ser una función.");
  if (typeof onSessionEvent !== "function") throw new TypeError("El observador de eventos de sesión debe ser una función.");
  if (typeof presentation !== "boolean") throw new TypeError("La opción de presentación causal debe ser booleana.");
  if (typeof primePilotOnWelcome !== "boolean") throw new TypeError("La opción de arranque causal del piloto debe ser booleana.");
  if (typeof metadata !== "boolean") throw new TypeError("La opción de metadatos causales debe ser booleana.");
  const sessionRole = () => activeRoom?.role === "guest" ? "guest" : "host";
  const causalRole = () => activeRoom?.role === "guest" ? "pilot" : "host";
  const playerName = () => normalizeP2PPlayerName(nameInput?.value, causalRole());
  const hasRequiredPlayerName = () => Boolean(String(nameInput?.value || "").replace(/\s+/gu, " ").trim());
  const updateRequiredIdentityState = () => {
    if (!primary) return;
    if (lifecycleState === "error" && sessionFailed) return;
    primary.disabled = !canStartRoom() || !hasRequiredPlayerName();
    if (joinRoomCode) joinRoomCode.disabled = !canStartRoom() || !hasRequiredPlayerName() || !String(roomCodeInput?.value || "").trim();
  };
  const getCausalContext = () => {
    if (!activeRoom) return null;
    if (causalContext) return causalContext;
    // Both peers must derive the same causal context from the room. The
    // transport role is carried separately and must never be part of the
    // session identity, otherwise the first hello/snapshot is rejected as a
    // cross-session message after a successful WebRTC negotiation.
    const sessionId = `p2p-room-${activeRoom.roomId}`;
    const input = Object.freeze({ roomId: activeRoom.roomId, sessionId, role: causalRole() });
    const produced = typeof causalContextFactory === "function"
      ? causalContextFactory(input)
      : { roomId: input.roomId, sessionId: input.sessionId };
    if (!produced || typeof produced !== "object") {
      throw new TypeError("La fábrica de contexto causal no devolvió un contexto válido.");
    }
    causalContext = Object.freeze({ ...produced, roomId: produced.roomId || input.roomId, sessionId: produced.sessionId || input.sessionId });
    return causalContext;
  };

  const createCausalSession = (options) => {
    const dependencies = {
      ...options,
      context: getCausalContext(),
      roomId: getCausalContext().roomId,
      sessionId: getCausalContext().sessionId,
      identityName: playerName(),
      hostFactory: causalHostFactory || hostFactory || undefined,
      onIdentity: (identity) => {
        if (!identity || (identity.role !== "host" && identity.role !== "pilot")) return;
        const name = normalizeP2PPlayerName(identity.name, identity.role);
        try { onPeerIdentity(Object.freeze({ role: identity.role, name })); } catch { /* Presentation observers cannot affect transport. */ }
      },
      // The online renderer needs a two-car authoritative frame before it can
      // claim the canvas and start sending normal input. Prime that frame as
      // soon as the pilot receives the causal welcome; otherwise both peers
      // can report an open transport while the visible offline practice still
      // owns the canvas and no first command can ever be sent.
      ...(presentation ? { primePilotOnWelcome: true } : {}),
      ...(metadata ? { metadata } : {}),
      ...(metadata ? { onMetadata: (value, context) => onMetadata(value, context) } : {}),
    };
    const source = Function.prototype.toString.call(CausalRoomSession);
    if (/^class\s/.test(source)) return new CausalRoomSession(dependencies);
    const created = CausalRoomSession(dependencies);
    if (created && typeof created === "object") return created;
    return new CausalRoomSession(dependencies);
  };

  if (notice) notice.textContent = causalEnabled
    ? "Partida online privada 1v1: el anfitrión ejecuta RocketSim R20 en WASM y ambos navegadores presentan snapshots validados."
    : "Esta versión todavía no inicia una partida ni intercambia datos de juego. La conexión P2P solo prepara el canal entre las dos personas.";

  try { nameInput.value = localStorageRef.getItem("arsenal.p2p.player-name") || ""; } catch { /* Storage may be blocked. */ }
  nameInput.addEventListener("input", () => {
    try { localStorageRef.setItem("arsenal.p2p.player-name", nameInput.value.slice(0, 32)); } catch { /* Optional preference only. */ }
    updateRequiredIdentityState();
  });
  roomCodeInput?.addEventListener("input", updateRequiredIdentityState);
  const setStatus = (message = "") => {
    status.textContent = message;
    status.hidden = !message;
  };
  const setRoomCodeStatus = (message = "") => {
    if (!roomCodeStatus) return;
    roomCodeStatus.textContent = message;
    roomCodeStatus.hidden = !message;
  };
  const setRetryAvailable = (message = P2P_ROOM_ERROR_MESSAGES.direct) => {
    primary.textContent = "Reintentar conexión";
    primary.disabled = !Boolean(client.origin);
    setStatus(message);
  };
  const setLifecycleState = (state) => {
    if (!Object.hasOwn(P2P_ROOM_LIFECYCLE_LABELS, state)) state = "error";
    if (lifecycleState === state) return;
    lifecycleState = state;
    setStatus(p2pRoomLifecycleLabel(state));
    notifySessionEvent({ type: "lifecycle", state });
  };
  const showRoom = (caption, url = "", roomCode = null) => {
    roomCaption.textContent = caption;
    inviteInput.value = url;
    if (roomCodeDisplay) roomCodeDisplay.hidden = !roomCode;
    if (roomCodeValue) {
      if ("value" in roomCodeValue) roomCodeValue.value = roomCode || "";
      else roomCodeValue.textContent = roomCode || "";
    }
    roomPanel.hidden = false;
  };
  const resetView = () => {
    roomPanel.hidden = true;
    if (roomCodeDisplay) roomCodeDisplay.hidden = true;
    primary.disabled = !canStartRoom();
  };
  const closeSession = () => {
    const current = session;
    session = null;
    directChannelReady = false;
    if (current) current.close();
  };
  // A guest may leave while the host room is still alive. Recycle only the
  // exhausted WebRTC/causal session so the same host invite can accept a new
  // guest; signaling credentials and the room itself remain unchanged.
  const prepareHostForNextPeer = () => {
    if (activeRoom?.role !== "host") return false;
    setLifecycleState("waitingReplacement");
    closeSession();
    sessionAttempted = false;
    sessionFailed = false;
    peerReady = false;
    causalContext = null;
    return true;
  };

  const canRetryRoom = room => Boolean(room && (room.role === "host" || room.role === "guest")
    && typeof room.roomId === "string" && typeof room.secret === "string"
    && Number.isSafeInteger(room.expiresAt) && room.expiresAt > now());
  const rememberRetryRoom = room => {
    retryRoom = canRetryRoom(room) ? Object.freeze({ ...room }) : null;
    return retryRoom;
  };
  const forgetRetryRoom = () => { retryRoom = null; };
  const reconnectRoom = () => {
    const room = canRetryRoom(retryRoom) ? retryRoom : null;
    if (!room) return false;
    reconnecting = true;
    try {
      // A WebRTC failure can leave signaling open. Close that old socket
      // before connecting again; otherwise the public retry button merely
      // throws "Ya hay una conexión" and leaves the player stranded.
      closeSession();
      client.close();
      activeRoom = { ...room };
      sessionAttempted = false;
      sessionFailed = false;
      peerReady = false;
      causalContext = null;
      client.connect(activeRoom);
      primary.disabled = true;
      setStatus("Reintentando la conexión privada…");
      return true;
    } catch {
      sessionFailed = true;
      setLifecycleState("error");
      setRetryAvailable();
      return false;
    } finally {
      reconnecting = false;
    }
  };

  // Keep the optional presentation observer outside transport/authority. Only
  // expose event type, causal role, and bounded error text; signaling payloads
  // and other transport fields never reach the beta page.
  const notifySessionEvent = (event = {}) => {
    if (event.type === "ice-state" && !isP2PIceConnectionState(event.state)) return;
    const observable = { type: event.type };
    if (event.type === "lifecycle" && Object.hasOwn(P2P_ROOM_LIFECYCLE_LABELS, event.state)) observable.state = event.state;
    if (event.role === "host" || event.role === "pilot" || event.role === "guest") observable.role = event.role;
    if (event.type === "ice-state" && isP2PIceConnectionState(event.state)) observable.state = event.state;
    if (event.type === "causal-ready" && (event.role === "host" || event.role === "pilot")) {
      observable.name = playerName();
    }
    try { onSessionEvent(Object.freeze(observable)); } catch { /* Observers cannot affect transport. */ }
  };

  const startSession = ({ role } = {}) => {
    if (!activeRoom || role !== activeRoom.role) return;
    if (session) {
      if (activeRoom.role === "host" && peerReady) session.beginOffer?.();
      return;
    }
    if (sessionAttempted) return;
    sessionAttempted = true;
    directChannelReady = false;
    try {
      const onSessionEvent = (event = {}) => {
        if (event.type === "negotiating") {
          setLifecycleState(peerReady ? "negotiating" : "waitingOpponent");
        } else if (event.type === "ice-state") {
          // ICE is transport detail. The lifecycle remains negotiating until
          // the causal handshake is ready, and no candidate/address is shown.
        } else if (event.type === "channel-open") {
          directChannelReady = true;
          if (!causalEnabled) setLifecycleState("channelReady");
        } else if (event.type === "causal-ready") {
          directChannelReady = true;
          setLifecycleState("channelReady");
        } else if (event.type === "causal-message") {
          setLifecycleState("active");
        } else if (event.type === "peer-left") {
          if (event.role === "host" || activeRoom?.role === "guest") setLifecycleState("hostLeft");
          else if (activeRoom?.role === "host") setLifecycleState("waitingReplacement");
          else setLifecycleState("error");
        } else if (event.type === "error") {
          sessionFailed = true;
          setLifecycleState("error");
          setRetryAvailable();
        } else if (event.type === "closed") {
          session = null;
          if (!sessionFailed && lifecycleState !== "waitingReplacement" && lifecycleState !== "hostLeft") {
            setLifecycleState("error");
            setRetryAvailable();
          }
        }
        notifySessionEvent(event);
      };
      if (causalEnabled) {
        session = createCausalSession({
          role: sessionRole(),
          presentation,
          primePilotOnWelcome,
          signaling: client,
          iceServers,
          onEvent: onSessionEvent,
          onSnapshot: (snapshot, metadata) => onCausalSnapshot(snapshot, metadata),
          ...(metadata ? { metadata } : {}),
          ...(metadata ? { onMetadata: (value, context) => onMetadata(value, context) } : {}),
        });
      } else {
        session = new WebRTCSession({
          role: activeRoom.role,
          signaling: client,
          iceServers,
          offerMode: activeRoom.role === "host" ? "deferred" : "automatic",
          onEvent: onSessionEvent,
        });
      }
      if (!session || typeof session.start !== "function") throw new TypeError("La sesión P2P no es válida.");
      session.start();
      if (activeRoom.role === "host" && peerReady) session.beginOffer?.();
    } catch (error) {
      sessionFailed = true;
      closeSession();
      setLifecycleState("error");
      setRetryAvailable();
    }
  };

  client.on("ready", ({ role } = {}) => {
    if (activeRoom && role === activeRoom.role && sessionAttempted) return;
    setLifecycleState("waitingOpponent");
    primary.disabled = true;
    startSession({ role });
  });
  client.on("peer-left", ({ role }) => {
    // Once WebRTC is open, only the direct DataChannel can authoritatively say
    // that the opponent left. Signaling may disappear independently.
    if (directChannelReady && session && !sessionFailed) return;
    if (role === "guest" && prepareHostForNextPeer()) return;
    setLifecycleState(role === "host" ? "hostLeft" : "error");
  });
  client.on("signal", () => {
    // Signaling frames are intentionally invisible to the lifecycle UI.
  });
  client.on("peer-ready", ({ role } = {}) => {
    if (!activeRoom || role !== (activeRoom.role === "host" ? "guest" : "host")) return;
    if (peerReady) return;
    peerReady = true;
    setLifecycleState("negotiating");
    // startSession() begins the deferred host offer itself when peerReady is
    // already true. Calling beginOffer again here would be harmless for the
    // production idempotent session, but it is needless work and can make a
    // replacement-peer transition look like two starts to an adapter.
    if (!session && activeRoom.role === "host") {
      startSession({ role: activeRoom.role });
      return;
    }
    if (session && activeRoom.role === "host") session.beginOffer?.();
  });
  client.on("error", () => {
    if (directChannelReady && session && !sessionFailed) return;
    setLifecycleState("error");
    setRetryAvailable();
  });
  client.on("closed", ({ reason }) => {
    // A signaling socket is a rendezvous channel, not the match transport.
    // Do not close a live WebRTC session merely because that socket ended.
    if (reason !== "local" && directChannelReady && session && !sessionFailed) return;
    if (reason === "host-left") setLifecycleState("hostLeft");
    else if (reason !== "local" && lifecycleState !== "waitingReplacement" && lifecycleState !== "hostLeft") {
      setLifecycleState("error");
      setRetryAvailable();
    }
    if (reason === "host-left" || reason === "expired" || (reason === "local" && !reconnecting)) forgetRetryRoom();
    if (reason === "local") activeRoom = null;
    closeSession();
    activeRoom = null;
    sessionAttempted = false;
    primary.disabled = !canStartRoom();
  });

  if (!client.origin) {
    setStatus("La publicación del servicio de señalización está pendiente. Esta página permanece desconectada.");
    primary.textContent = "Señalización pendiente";
    if (lifecycleState === "error") {
      // A retry is always a deliberate new attempt. Never reconnect in a
      // lifecycle callback, and never reuse an exhausted WebRTC session.
      closeSession();
      client.close();
      activeRoom = null;
      sessionAttempted = false;
      sessionFailed = false;
      peerReady = false;
      causalContext = null;
      roomPanel.hidden = true;
      lifecycleState = null;
      if (invite && invite.expiresAt > now()) {
        primary.textContent = "Unirme a la sala";
        setStatus(`Invitación recibida · caduca ${new Date(invite.expiresAt).toLocaleTimeString()}.`);
      } else {
        primary.textContent = "Crear sala privada";
        setStatus();
      }
    }
    primary.disabled = true;
    if (joinRoomCode) joinRoomCode.disabled = true;
    if (invite) inviteNote.hidden = false;
    return {
      client,
      invite,
      get session() { return session; },
      sendCausalCommand: () => Object.freeze({ accepted: false, reason: "La señalización no está disponible." }),
      destroy: () => { closeSession(); client.close(); },
    };
  }

  if (invite && invite.expiresAt > now()) {
    inviteNote.hidden = false;
    primary.textContent = "Unirme a la sala";
    setStatus(`Invitación recibida · caduca ${new Date(invite.expiresAt).toLocaleTimeString()}.`);
  } else {
    primary.textContent = "Crear sala privada";
    setStatus();
  }
  primary.disabled = !Boolean(client.origin);
  updateRequiredIdentityState();

  primary.addEventListener("click", async () => {
    if (!hasRequiredPlayerName()) {
      setStatus("Escribe un nombre para crear o unirte a una sala.");
      nameInput?.focus?.();
      updateRequiredIdentityState();
      return;
    }
    primary.disabled = true;
    try {
      if (sessionFailed && reconnectRoom()) return;
      if (invite && invite.expiresAt > now()) {
        activeRoom = { role: "guest", roomId: invite.roomId, secret: invite.guestSecret, expiresAt: invite.expiresAt };
        rememberRetryRoom(activeRoom);
        nameInput.value = playerName();
        sessionAttempted = false;
        sessionFailed = false;
        peerReady = false;
        causalContext = null;
        client.connect(activeRoom);
      setStatus("Conectando a la sala…");
        return;
      }
      setStatus("Creando sala…");
      const room = await client.createRoom();
      const url = createP2PInviteUrl(locationRef.href, room);
      activeRoom = { roomId: room.roomId, role: "host", secret: room.hostSecret, expiresAt: room.expiresAt };
      rememberRetryRoom(activeRoom);
      nameInput.value = playerName();
      sessionAttempted = false;
      sessionFailed = false;
      peerReady = false;
      causalContext = null;
      client.connect(activeRoom);
      showRoom(`Sala creada. Caduca ${new Date(room.expiresAt).toLocaleTimeString()}. Mantén esta pestaña visible mientras se conecta tu rival.`, url, room.roomCode || null);
      setRoomCodeStatus(room.roomCode
        ? "Comparte esta clave con tu rival."
        : "El servicio aún no ha emitido una clave corta; usa la invitación técnica de respaldo.");
      setStatus("Conectando con el servicio de señalización…");
    } catch (error) {
      setLifecycleState("error");
      setRetryAvailable(P2P_ROOM_ERROR_MESSAGES.create);
    }
  });
  joinRoomCode?.addEventListener("click", async () => {
    // For 2v2/3v3/FFA the beta entry owns navigation to the multiplayer page;
    // do not start a hidden 1v1 request in parallel with that navigation.
    if (joinRoomCode === unifiedJoin && documentRef.getElementById("match-mode")?.value !== "1v1") return;
    if (!hasRequiredPlayerName()) {
      setStatus("Escribe un nombre para crear o unirte a una sala.");
      nameInput?.focus?.();
      return;
    }
    const value = roomCodeInput?.value || "";
    if (!value.trim()) {
      setRoomCodeStatus("Escribe la clave de sala.");
      return;
    }
    joinRoomCode.disabled = true;
    try {
      const joined = await client.joinRoomByCode(value);
      activeRoom = { role: "guest", roomId: joined.roomId, secret: joined.guestSecret, expiresAt: joined.expiresAt };
      rememberRetryRoom(activeRoom);
      sessionAttempted = false;
      sessionFailed = false;
      peerReady = false;
      causalContext = null;
      inviteNote.hidden = true;
      setStatus("Conectando con la sala…");
      client.connect(activeRoom);
    } catch (error) {
      setRoomCodeStatus(error instanceof Error ? error.message : "No se pudo usar la clave.");
    } finally {
      joinRoomCode.disabled = false;
    }
  });
  documentRef.getElementById("copy-invite").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(inviteInput.value);
      setStatus("Invitación copiada. Compártela solo con la otra persona.");
    } catch {
      inviteInput.focus(); inviteInput.select();
      setStatus("No se pudo copiar automáticamente. Selecciona y copia el enlace.");
    }
  });
  copyRoomCode?.addEventListener("click", async () => {
    const code = ("value" in roomCodeValue ? roomCodeValue.value : roomCodeValue.textContent || "").trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Clave copiada. Envíala a tu rival.");
    } catch {
      roomCodeValue.focus(); roomCodeValue.select?.();
      setStatus("Selecciona la clave y cópiala para enviarla.");
    }
  });
  documentRef.getElementById("leave").addEventListener("click", () => {
    activeRoom = null;
    forgetRetryRoom();
    closeSession();
    client.close();
    resetView();
    setStatus("Sala cerrada.");
  });
  const sendCausalCommand = (command) => {
    const current = session;
    if (activeRoom?.role !== "guest" || current?.role !== "pilot" || !current.channelReady
      || typeof current.causalSession?.sendCommand !== "function") {
      return Object.freeze({ accepted: false, reason: "El canal causal del piloto aún no está listo." });
    }
    try { return current.causalSession.sendCommand(command); }
    catch (error) {
      return Object.freeze({ accepted: false, reason: error instanceof Error ? error.message : "No se pudo enviar el comando causal." });
    }
  };
  const setCausalHostCommand = (command) => {
    const current = session;
    if (activeRoom?.role !== "host" || current?.role !== "host" || !current.channelReady
      || typeof current.setHostCommand !== "function") {
      return Object.freeze({ accepted: false, reason: "El host causal aún no está listo para controles." });
    }
    try { return current.setHostCommand(command); }
    catch (error) {
      return Object.freeze({ accepted: false, reason: error instanceof Error ? error.message : "No se pudo actualizar el control del host." });
    }
  };
  return { client, invite, get session() { return session; }, sendCausalCommand, setCausalHostCommand, destroy: () => { closeSession(); client.close(); } };
}

const bootedLobbies = new WeakMap();

/** Start one lobby per document. The beta entry uses this after opting out of
 * the legacy auto-start marker in its HTML. */
export function bootP2PRoomLobby(options = {}) {
  const documentRef = options.documentRef || (typeof document !== "undefined" ? document : null);
  if (!documentRef) return null;
  const existing = bootedLobbies.get(documentRef);
  if (existing) return existing;
  const controller = initializeP2PRoomLobby({ ...options, documentRef });
  bootedLobbies.set(documentRef, controller);
  return controller;
}

function shouldAutoBoot(documentRef) {
  return documentRef?.documentElement?.dataset?.p2pRoomLobbyAutoStart !== "false";
}

if (typeof document !== "undefined" && shouldAutoBoot(document)) bootP2PRoomLobby();
