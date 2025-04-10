const WebSocket = require("ws");
const sessionManager = require("./session");
const { firestore } = require("./firebaseConfig");

const wss = new WebSocket.Server({ port: 8080 });
let clients = new Map();

// Trial phase constants
const PHASE_DURATION = 15000; // 15 seconds for each phase
const CHAT_DURATION = 10000; // 10 seconds
const PHASES = {
  INITIAL: "initial",
  GROUP_DELIB: "groupDelib",
  FINAL_DECISION: "finalDecision",
  RESULT: "result",
};

// Session state map to track trial phases for each session
const sessionStates = new Map();

function broadcastParticipantCount() {
  const count = clients.size;
  const message = JSON.stringify({ type: "participantCount", count });
  clients.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
    }
  });
}

function broadcastSessionUpdate(updateData) {
  const message = JSON.stringify({ type: "sessionUpdate", ...updateData });

  // If this is a running session, initialize trial state
  if (updateData.status === "running") {
    initializeSessionState(updateData.sessionID, updateData.mode);
  }

  clients.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
    }
  });
}

function initializeSessionState(sessionID, mode) {
  if (!sessionID) return;

  // Get the session data to access AI mode
  const getSessionData = async () => {
    try {
      const sessionRef = firestore.collection("sessions").doc(sessionID);
      const sessionDoc = await sessionRef.get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();

        // Initialize session state with AI mode data
        sessionStates.set(sessionID, {
          currentTrial: 1,
          totalTrials: 5, // For testing (use 50 in production)
          currentPhase: mode === "group" ? PHASES.GROUP_DELIB : PHASES.INITIAL,
          phaseStartTime: Date.now(),
          mode: mode,
          participants: sessionData.participants || [],
          participantData: {},
          trialResults: [],
          aiMode: sessionData.aiMode || "goodAI",
          csvFilePath: sessionData.csvFilePath || null,
          trialCount: sessionData.trialCount || 0,
        });

        console.log(
          `Session ${sessionID} initialized with ${
            sessionData.aiMode || "default"
          } AI mode`
        );

        if (sessionData.csvFilePath) {
          try {
            const trialData = await sessionManager.readCsvFile(sessionData.csvFilePath);

            const state = sessionStates.get(sessionID);
            if (state) {
              state.trialData = trialData;
              sessionStates.set(sessionID, state);
              console.log(
                `Loaded ${trialData.length} rows of trial data for session ${sessionID}`
              );
            }
          } catch (error) {
            console.error(`Error loading trial data: ${error.message}`);
          }
        }

        // Start the trial phase synchronization for this session
        startTrialPhase(sessionID);
      }
    } catch (error) {
      console.error("Error getting session data:", error);
      // Fallback initialization
      sessionStates.set(sessionID, {
        currentTrial: 1,
        totalTrials: 5,
        currentPhase: mode === "group" ? PHASES.GROUP_DELIB : PHASES.INITIAL,
        phaseStartTime: Date.now(),
        mode: mode,
        participants: [],
        participantData: {},
        trialResults: [],
      });
      startTrialPhase(sessionID);
    }
  };

  getSessionData();
}

function startTrialPhase(sessionID) {
  if (!sessionStates.has(sessionID)) return;

  const state = sessionStates.get(sessionID);
  let duration = PHASE_DURATION;
  if (state.mode === "group" && state.currentPhase === PHASES.GROUP_DELIB) {
    duration = CHAT_DURATION + PHASE_DURATION;
  }
  console.log(
    `Starting phase ${state.currentPhase} for trial ${state.currentTrial} in session ${sessionID} with duration ${duration}ms`
  );

  let currentTrialData = null;
  if (
    state.trialData &&
    Array.isArray(state.trialData) &&
    state.trialData.length >= state.currentTrial
  ) {
    currentTrialData = state.trialData[state.currentTrial - 1];
  }

  // Send phase start notification to all clients in this session
  broadcastToSession(sessionID, {
    type: "phaseChange",
    phase: state.currentPhase,
    trial: state.currentTrial,
    totalTrials: state.totalTrials,
    startTime: Date.now(),
    duration: duration,
    chatDuration:
      state.currentPhase === PHASES.GROUP_DELIB ? CHAT_DURATION : null,
    aiMode: sessionStates.get(sessionID).aiMode,
    trialData: currentTrialData,
  });

  // Schedule the next phase transition
  setTimeout(() => {
    transitionToNextPhase(sessionID);
  }, duration);
}

function transitionToNextPhase(sessionID) {
  if (!sessionStates.has(sessionID)) return;

  const state = sessionStates.get(sessionID);
  let nextPhase;

  // Determine next phase based on current phase and mode
  switch (state.currentPhase) {
    case PHASES.INITIAL:
      nextPhase = PHASES.FINAL_DECISION;
      break;
    case PHASES.GROUP_DELIB:
      nextPhase = PHASES.FINAL_DECISION;
      break;
    case PHASES.FINAL_DECISION:
      nextPhase = PHASES.RESULT;
      break;
    case PHASES.RESULT:
      // After result phase, go to the next trial or end session
      state.currentTrial++;
      if (state.currentTrial <= state.totalTrials) {
        nextPhase =
          state.mode === "group" ? PHASES.GROUP_DELIB : PHASES.INITIAL;
      } else {
        // End of all trials, send completion message
        broadcastToSession(sessionID, {
          type: "trialsCompleted",
        });
        sessionStates.delete(sessionID);
        return;
      }
      break;
  }

  // Update session state
  state.currentPhase = nextPhase;
  state.phaseStartTime = Date.now();
  sessionStates.set(sessionID, state);

  // Start the next phase
  startTrialPhase(sessionID);
}

function broadcastToSession(sessionID, message) {
  if (!sessionID) return;

  const messageStr = JSON.stringify(message);
  clients.forEach((clientWs, clientID) => {
    const clientSession = getClientSession(clientID);
    if (clientSession === sessionID && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(messageStr);
    }
  });
}

function getClientSession(clientID) {
  // We need to track which session each client belongs to
  // This could be added to the clients map or stored separately
  const sessionID = sessionManager.getClientSessionID(clientID);
  return sessionID;
}

function broadcastChatMessage(data) {
  // Get the sessionID for this client
  const sessionID = getClientSession(data.clientID);
  if (!sessionID) return;

  // Store chat message in session state
  if (sessionStates.has(sessionID)) {
    const state = sessionStates.get(sessionID);
    if (!state.participantData[data.clientID]) {
      state.participantData[data.clientID] = { chatMessages: [] };
    }

    sessionStates.set(sessionID, state);
  }

  // Broadcast only to clients in this session
  const message = JSON.stringify(data);
  clients.forEach((clientWs, clientID) => {
    const clientSession = getClientSession(clientID);
    if (clientSession === sessionID && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
    }
  });
}

function updateParticipantData(sessionID, clientID, dataType, value) {
  if (!sessionStates.has(sessionID)) return;

  const state = sessionStates.get(sessionID);
  if (!state.participantData[clientID]) {
    state.participantData[clientID] = {};
  }

  state.participantData[clientID][dataType] = value;
  sessionStates.set(sessionID, state);

  // Broadcast wager confirmation to other participants in group mode for initial wagers
  if (dataType === "initialWager" && state.mode === "group") {
    broadcastToSession(sessionID, {
      type: "wagerConfirmed",
      clientID,
      wager: value,
      timestamp: Date.now(),
    });
  }
}

// Set up callback for session updates
sessionManager.setUpdateCallback(broadcastSessionUpdate);

wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      console.error("Invalid JSON received:", message);
      return;
    }

    if (data.type === "register" && data.clientID) {
      clients.set(data.clientID, ws);
      console.log(`Client registered: ${data.clientID}`);
      broadcastParticipantCount();

      // If client is rejoining an active session, send current state
      const sessionID = sessionManager.getClientSessionID(data.clientID);
      if (sessionID && sessionStates.has(sessionID)) {
        const state = sessionStates.get(sessionID);
        ws.send(
          JSON.stringify({
            type: "rejoinSession",
            sessionID,
            trial: state.currentTrial,
            totalTrials: state.totalTrials,
            phase: state.currentPhase,
            mode: state.mode,
            remainingTime: PHASE_DURATION - (Date.now() - state.phaseStartTime),
          })
        );
      }
    } else if (data.type === "chat" && data.clientID && data.message) {
      broadcastChatMessage(data);
    } else if (data.type === "startSession" && data.clientID) {
      try {
        const sessionResult = await sessionManager.startSession(data.clientID);
        ws.send(JSON.stringify({ type: "sessionStarted", ...sessionResult }));
      } catch (error) {
        console.error("Error starting session:", error);
        ws.send(JSON.stringify({ type: "error", message: error.message }));
      }
    } else if (data.type === "updateWager" && data.clientID && data.sessionID) {
      // Handle wager updates from clients
      updateParticipantData(
        data.sessionID,
        data.clientID,
        data.wagerType,
        data.value
      );
      ws.send(
        JSON.stringify({
          type: "wagerUpdated",
          message: "Wager updated successfully",
        })
      );
    } else if (
      data.type === "confirmDecision" &&
      data.clientID &&
      data.sessionID
    ) {
      // Handle client confirmations
      updateParticipantData(
        data.sessionID,
        data.clientID,
        `${data.phase}Confirmed`,
        true
      );
      ws.send(
        JSON.stringify({
          type: "decisionConfirmed",
          message: "Decision confirmed",
        })
      );
    } else if (data.type === "sendData" && data.payload) {
      try {
        await sessionManager.sendData(data.payload);
        ws.send(
          JSON.stringify({
            type: "dataSent",
            message: "Data sent successfully",
          })
        );

        // If this is trial data, store it in our session state too
        if (data.payload.event === "trialData" && data.payload.data.sessionID) {
          const sessionID = data.payload.data.sessionID;
          if (sessionStates.has(sessionID)) {
            const state = sessionStates.get(sessionID);
            state.trialResults.push(data.payload.data);
            sessionStates.set(sessionID, state);
          }
        }
      } catch (error) {
        console.error("Error sending data:", error);
        ws.send(JSON.stringify({ type: "error", message: error.message }));
      }
    } else {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unknown message type or missing required fields",
        })
      );
    }
  });

  ws.on("close", () => {
    for (const [clientID, clientWs] of clients.entries()) {
      if (clientWs === ws) {
        clients.delete(clientID);
        console.log(`Client disconnected: ${clientID}`);
        break;
      }
    }
    broadcastParticipantCount();
  });
});

console.log("WebSocket server is running on ws://localhost:8080");