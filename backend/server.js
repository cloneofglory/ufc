const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const sessionManager = require("./session");
const { firestore } = require("./firebaseConfig");
const path = require("path");

const app = express();

const exportCsvRouter = require("./routes/exportCsv");

// Mount the CSV route (no auth, link only protects it)
app.use("/exportCsv", exportCsvRouter);

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// Serve the researcher download page
app.get("/downloads", (req, res) => {
  res.sendFile(path.join(__dirname, "../downloads.html"));
});

const server = http.createServer(app);

// const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });
const wss = new WebSocket.Server({ server });

let clients = new Map();
let clientUserNames = new Map();

const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`Server running on PORT http ${PORT}`);
  console.log(`Websocket server running on PORT wss ${PORT}`);
});

// Trial phase constants
const PHASE_DURATION = 15000; // 15 seconds for wager OR final decision OR result display
const CHAT_DURATION = 30000; // 30 seconds for chat
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

  if (updateData.status === "running") {
    if (!sessionStates.has(updateData.sessionID)) {
      initializeSessionState(updateData.sessionID, updateData.mode);
    } else {
      const state = sessionStates.get(updateData.sessionID);
      console.log(
        `Session ${updateData.sessionID} already initialized, skipping re-init on update.`
      );
    }
  }

  clients.forEach((clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
    }
  });
}

function initializeSessionState(sessionID, mode) {
  if (sessionStates.has(sessionID)) {
    console.log(`Session ${sessionID} is already initialized. Skipping.`);
    return;
  }
  if (!sessionID) return;

  console.log(`Initializing state for session ${sessionID}, mode ${mode}`);

  // Get the session data to access AI mode
  const getSessionData = async () => {
    try {
      const sessionRef = firestore.collection("sessions").doc(sessionID);
      const sessionDoc = await sessionRef.get();
      if (sessionDoc.exists) {
        const sessionData = sessionDoc.data();
        const participants = sessionData.participants || [];

        const participantData = {};
        participants.forEach((pid) => {
          participantData[pid] = {
            initialWager: null,
            finalWager: null,
            wagerConfirmed: false,
            chatConfirmed: false,
            finalDecisionConfirmed: false,
            resultConfirmed: false,
            soloInitialConfirmed: false,
            chatMessages: [],
          };
        });

        // Initialize session state with AI mode data
        sessionStates.set(sessionID, {
          currentTrial: 1,
          totalTrials: 50,
          currentPhase: mode === "group" ? PHASES.GROUP_DELIB : PHASES.INITIAL,
          currentSubPhase: mode === "group" ? "wager" : null,
          phaseStartTime: Date.now(),
          mode: mode,
          participants: participants,
          participantData: participantData,
          trialResults: [],
          aiMode: sessionData.aiMode || "goodAI",
          csvFilePath: sessionData.csvFilePath || null,
          trialCount: sessionData.trialCount || 0,
          trialData: null,
        });

        console.log(
          `Session ${sessionID} initialized with ${
            sessionData.aiMode || "default"
          } AI mode, Participants: ${participants.join(", ")}`
        );

        if (sessionData.csvFilePath) {
          try {
            const rawData = await sessionManager.readCsvFile(
              sessionData.csvFilePath
            );
            let trialData;
            if (
              Array.isArray(sessionData.trialOrder) &&
              sessionData.trialOrder.length === rawData.length
            ) {
              trialData = sessionData.trialOrder.map((idx) => rawData[idx]);
              console.log(
                `Applied trialOrder for session ${sessionID}: [${sessionData.trialOrder.join(
                  ","
                )}]`
              );
            } else {
              trialData = rawData;
              if (sessionData.trialOrder)
                console.warn(
                  `Invalid trialOrder for session ${sessionID}, falling back to raw order.`
                );
            }

            const state = sessionStates.get(sessionID);
            if (state) {
              state.trialData = trialData;
              sessionStates.set(sessionID, state);
              console.log(
                `Loaded ${trialData.length} rows of trial data for session ${sessionID}. Total trials set to ${state.totalTrials}.`
              );
            }
          } catch (error) {
            console.error(
              `Error loading trial data for session ${sessionID}: ${error.message}`
            );
            const state = sessionStates.get(sessionID);
            if (state) {
              state.totalTrials = 0;
              state.trialData = [];
              sessionStates.set(sessionID, state);
              console.warn(
                `Setting totalTrials to 0 for session ${sessionID} due to CSV loading error.`
              );
            }
          }
        } else {
          console.warn(
            `No csvFilePath found for session ${sessionID}. Trial data will be missing.`
          );
          const state = sessionStates.get(sessionID);
          if (state) {
            state.totalTrials = 0;
            state.trialData = [];
            sessionStates.set(sessionID, state);
            console.warn(
              `Setting totalTrials to 0 for session ${sessionID} due to missing csvFilePath.`
            );
          }
        }

        setTimeout(() => {
          startTrialPhase(sessionID);
        }, 500);
      } else {
        console.error(`Session document ${sessionID} does not exist.`);
        if (sessionStates.has(sessionID)) sessionStates.delete(sessionID);
      }
    } catch (error) {
      console.error("Error getting session data during initialization:", error);
      if (sessionStates.has(sessionID)) sessionStates.delete(sessionID);
    }
  };

  getSessionData();
}

function startTrialPhase(sessionID) {
  if (!sessionStates.has(sessionID)) {
    console.warn(
      `Attempted to start trial phase for non-existent session state: ${sessionID}`
    );
    return;
  }

  const state = sessionStates.get(sessionID);
  let duration;

  if (state.mode === "group" && state.currentPhase === PHASES.GROUP_DELIB) {
    if (state.currentSubPhase === "wager") duration = PHASE_DURATION;
    else duration = CHAT_DURATION;
  } else if (
    state.currentPhase === PHASES.INITIAL ||
    state.currentPhase === PHASES.FINAL_DECISION
  ) {
    duration = PHASE_DURATION;
  } else {
    duration = PHASE_DURATION;
  }

  state.participants.forEach((pid) => {
    if (!state.participantData[pid]) state.participantData[pid] = {};

    state.participantData[pid].wagerConfirmed =
      state.currentPhase !== PHASES.GROUP_DELIB ||
      state.currentSubPhase !== "wager";
    state.participantData[pid].finalDecisionConfirmed =
      state.currentPhase !== PHASES.FINAL_DECISION;
    state.participantData[pid].resultConfirmed =
      state.currentPhase !== PHASES.RESULT;
    state.participantData[pid].soloInitialConfirmed =
      state.currentPhase !== PHASES.INITIAL;
  });

  console.log(
    `Starting phase ${state.currentPhase}${
      state.currentSubPhase ? ` (${state.currentSubPhase})` : ""
    } for trial ${state.currentTrial}/${
      state.totalTrials
    } in session ${sessionID} with duration ${duration}ms`
  );

  let currentTrialData = null;
  if (
    state.trialData &&
    Array.isArray(state.trialData) &&
    state.trialData.length >= state.currentTrial
  ) {
    currentTrialData = state.trialData[state.currentTrial - 1];
  } else {
    console.warn(
      `Trial data not found for trial ${state.currentTrial} in session ${sessionID}`
    );
    if (state.totalTrials > 0 && state.currentTrial <= state.totalTrials) {
      console.error(
        `Critical error: Missing trial data for session ${sessionID}, trial ${state.currentTrial}. Ending session.`
      );
      broadcastToSession(sessionID, {
        type: "error",
        message: "Critical error: Missing trial data. Session ended.",
      });
      sessionStates.delete(sessionID);
      return;
    }
  }

  // Send phase start notification to all clients in this session
  broadcastToSession(sessionID, {
    type: "phaseChange",
    sessionID: sessionID,
    phase: state.currentPhase,
    subPhase: state.currentSubPhase,
    trial: state.currentTrial,
    totalTrials: state.totalTrials,
    startTime: Date.now(),
    duration: duration,
    wagerDuration:
      state.currentPhase === PHASES.GROUP_DELIB &&
      state.currentSubPhase === "wager"
        ? PHASE_DURATION
        : null,
    chatDuration:
      state.currentPhase === PHASES.GROUP_DELIB &&
      state.currentSubPhase === "chat"
        ? CHAT_DURATION
        : null,
    aiMode: state.aiMode,
    trialData: currentTrialData,
  });

  if (state.phaseTimeoutId) clearTimeout(state.phaseTimeoutId);

  state.phaseTimeoutId = setTimeout(() => {
    transitionToNext(sessionID);
  }, duration);
  sessionStates.set(sessionID, state);
}

function transitionToNext(sessionID) {
  if (!sessionStates.has(sessionID)) return;

  const state = sessionStates.get(sessionID);
  if (state.phaseTimeoutId) {
    clearTimeout(state.phaseTimeoutId);
    state.phaseTimeoutId = null;
  }

  switch (state.currentPhase) {
    case PHASES.INITIAL:
      state.currentPhase = PHASES.FINAL_DECISION;
      break;

    case PHASES.GROUP_DELIB:
      if (state.currentSubPhase === "wager") {
        state.currentSubPhase = "chat";
        state.phaseStartTime = Date.now();
        checkAndBroadcastWagers(sessionID);
      } else {
        state.currentPhase = PHASES.FINAL_DECISION;
        state.currentSubPhase = null;
      }
      break;

    case PHASES.FINAL_DECISION:
      state.currentPhase = PHASES.RESULT;
      break;

    case PHASES.RESULT:
      state.currentTrial++;
      if (state.currentTrial <= state.totalTrials) {
        if (state.mode === "group") {
          state.currentPhase = PHASES.GROUP_DELIB;
          state.currentSubPhase = "wager";
        } else {
          state.currentPhase = PHASES.INITIAL;
          state.currentSubPhase = null;
        }
        Object.keys(state.participantData).forEach((pid) => {
          if (state.participantData[pid]) {
            state.participantData[pid].initialWager = null;
            state.participantData[pid].finalWager = null;
          }
        });
      } else {
        broadcastToSession(sessionID, { type: "trialsCompleted" });
        sessionStates.delete(sessionID);
        console.log(
          `Session ${sessionID} completed all trials and was removed.`
        );
        return;
      }
      break;
  }

  if (state.currentSubPhase !== "chat") {
    state.phaseStartTime = Date.now();
  }

  sessionStates.set(sessionID, state);

  startTrialPhase(sessionID);
}

function broadcastToSession(sessionID, message) {
  if (!sessionID || !sessionStates.has(sessionID)) return;

  const messageStr = JSON.stringify(message);
  const state = sessionStates.get(sessionID);

  state.participants.forEach((clientID) => {
    const clientWs = clients.get(clientID);
    if (clientWs && clientWs.readyState === WebSocket.OPEN) {
      try {
        clientWs.send(messageStr);
      } catch (error) {
        console.error(`Failed to send message to client ${clientID}:`, error);
      }
    } else {
      console.warn(
        `Client ${clientID} not found or connection not open in session ${sessionID}.`
      );
    }
  });
}

function getClientSession(clientID) {
  for (const [sid, state] of sessionStates.entries()) {
    if (state.participants.includes(clientID)) {
      return sid;
    }
  }
  return sessionManager.getClientSessionID(clientID);
}

function broadcastChatMessage(data) {
  const sessionID = getClientSession(data.clientID);
  if (!sessionID || !sessionStates.has(sessionID)) return;

  const state = sessionStates.get(sessionID);
  const message = JSON.stringify(data);

  state.participants.forEach((pid) => {
    const clientWs = clients.get(pid);
    if (
      pid !== data.clientID &&
      clientWs &&
      clientWs.readyState === WebSocket.OPEN
    ) {
      try {
        clientWs.send(message);
      } catch (error) {
        console.error(`Failed to broadcast chat message to ${pid}:`, error);
      }
    }
  });
}

function updateParticipantData(sessionID, clientID, dataType, value) {
  if (!sessionStates.has(sessionID)) {
    console.warn(
      `Attempted to update data for non-existent session: ${sessionID}`
    );
    return;
  }

  const state = sessionStates.get(sessionID);
  if (!state.participantData[clientID]) {
    console.warn(
      `Attempted to update data for client ${clientID} not found in session ${sessionID}`
    );
    state.participantData[clientID] = {};
  }

  state.participantData[clientID][dataType] = value;
  console.log(
    `Stored ${dataType} for ${clientID} in session ${sessionID} as: ${value}`
  );

  if (dataType === "initialWager" && state.mode === "group") {
    state.participantData[clientID].wagerConfirmed = true;
     broadcastToSession(sessionID, {
      type: "individualWager",
      clientID: clientID,
      userName: clientUserNames.get(clientID) || clientID,
      wager: value,
      trial: state.currentTrial
    });
    // checkAndBroadcastWagers(sessionID);
  }

  sessionStates.set(sessionID, state);
}

function checkAndBroadcastWagers(sessionID) {
  if (!sessionStates.has(sessionID)) return;
  const state = sessionStates.get(sessionID);

  if (state.mode !== "group") return;

  let allConfirmed = true;
  let receivedCount = 0;
  const currentWagers = {};
  const userNames = {};

  for (const pid of state.participants) {
    if (!state.participantData[pid]) {
      console.warn(
        `Missing participantData for ${pid} in session ${sessionID} during wager check.`
      );
      state.participantData[pid] = { initialWager: null };
    }

    if (state.participantData[pid].initialWager === null) {
      allConfirmed = false;
    } else {
      receivedCount++;
    }
    currentWagers[pid] = state.participantData[pid].initialWager ?? 2;
    userNames[pid] = clientUserNames.get(pid) || pid;
  }

  const shouldBroadcast = allConfirmed || state.currentSubPhase === "chat";

  if (shouldBroadcast) {
    console.log(
      `Session ${sessionID} trial ${state.currentTrial}: Broadcasting wagers. All confirmed: ${allConfirmed}. Participants: ${state.participants.length}, Received: ${receivedCount}`
    );
    broadcastToSession(sessionID, {
      type: "allWagersSubmitted",
      trial: state.currentTrial,
      wagers: currentWagers,
      userNames: userNames
    });
  }
}

sessionManager.setUpdateCallback(broadcastSessionUpdate);

wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (error) {
      console.error("Invalid JSON received:", message);
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid JSON format." })
      );
      return;
    }

    const clientID = data.clientID;

    if (data.type === "register" && clientID) {
      clients.set(clientID, ws);
      console.log(`Client registered: ${clientID}`);
      if (data.userName) {
        clientUserNames.set(clientID, data.userName);
      }
      broadcastParticipantCount();

      const sessionID = getClientSession(clientID);

      if (sessionID && sessionStates.has(sessionID)) {
        const state = sessionStates.get(sessionID);
        const now = Date.now();
        const elapsed = now - state.phaseStartTime;

        let currentPhaseDuration;
        if (state.currentPhase === PHASES.GROUP_DELIB) {
          currentPhaseDuration =
            state.currentSubPhase === "wager" ? PHASE_DURATION : CHAT_DURATION;
        } else {
          currentPhaseDuration = PHASE_DURATION;
        }
        const remainingTime = Math.max(0, currentPhaseDuration - elapsed);

        ws.send(
          JSON.stringify({
            type: "rejoinSession",
            sessionID,
            trial: state.currentTrial,
            totalTrials: state.totalTrials,
            phase: state.currentPhase,
            subPhase: state.currentSubPhase,
            mode: state.mode,
            aiMode: state.aiMode,
            remainingTime: remainingTime,
            trialData:
              state.trialData && state.trialData.length >= state.currentTrial
                ? state.trialData[state.currentTrial - 1]
                : null,
            currentWagers:
              state.mode === "group" &&
              state.currentPhase === PHASES.GROUP_DELIB
                ? state.participants.reduce((acc, pid) => {
                    if (
                      state.participantData[pid] &&
                      state.participantData[pid].initialWager !== null
                    ) {
                      acc[pid] = state.participantData[pid].initialWager;
                    }
                    return acc;
                  }, {})
                : null,
          })
        );
        console.log(
          `Client ${clientID} rejoining active session ${sessionID} in phase ${
            state.currentPhase
          }${
            state.currentSubPhase ? ` (${state.currentSubPhase})` : ""
          } with ${remainingTime.toFixed(0)}ms remaining.`
        );
      } else if (sessionID) {
        console.log(
          `Client ${clientID} belongs to session ${sessionID}, but it's not currently active in server state.`
        );
        ws.send(
          JSON.stringify({
            type: "info",
            message:
              "Your previous session is not currently active. Starting fresh...",
          })
        );
      }
    } else if (data.type === "chat" && clientID && data.message) {
      const sessionID = getClientSession(clientID);
      if (sessionID && sessionStates.has(sessionID)) {
        const state = sessionStates.get(sessionID);
        if (
          state.mode === "group" &&
          state.currentPhase === PHASES.GROUP_DELIB &&
          state.currentSubPhase === "chat"
        ) {
          const chatData = {
            ...data,
            userName: clientUserNames.get(clientID) || clientID
          };
          broadcastChatMessage(chatData);
        } else {
          console.log(
            `Chat message from ${clientID} ignored: Not in group chat phase.`
          );
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Chat is not allowed at this time.",
            })
          );
        }
      } else {
        console.warn(
          `Chat message from ${clientID} for unknown/inactive session ${sessionID}`
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Cannot send chat message. Session not active.",
          })
        );
      }
    } else if (data.type === "startSession" && clientID) {
      try {
        const existingSessionID = getClientSession(clientID);
        if (existingSessionID && sessionStates.has(existingSessionID)) {
          console.log(
            `Client ${clientID} attempted to start a new session but is already in active session ${existingSessionID}. Sending rejoin info.`
          );
          const state = sessionStates.get(existingSessionID);
          const now = Date.now();
          const elapsed = now - state.phaseStartTime;
          let currentPhaseDuration;
          if (state.currentPhase === PHASES.GROUP_DELIB) {
            currentPhaseDuration =
              state.currentSubPhase === "wager"
                ? PHASE_DURATION
                : CHAT_DURATION;
          } else {
            currentPhaseDuration = PHASE_DURATION;
          }
          const remainingTime = Math.max(0, currentPhaseDuration - elapsed);
          ws.send(
            JSON.stringify({
              type: "rejoinSession",
              sessionID: existingSessionID,
              trial: state.currentTrial,
              totalTrials: state.totalTrials,
              phase: state.currentPhase,
              subPhase: state.currentSubPhase,
              mode: state.mode,
              aiMode: state.aiMode,
              remainingTime: remainingTime,
              trialData:
                state.trialData && state.trialData.length >= state.currentTrial
                  ? state.trialData[state.currentTrial - 1]
                  : null,
              currentWagers:
                state.mode === "group" &&
                state.currentPhase === PHASES.GROUP_DELIB
                  ? state.participants.reduce((acc, pid) => {
                      if (
                        state.participantData[pid] &&
                        state.participantData[pid].initialWager !== null
                      ) {
                        acc[pid] = state.participantData[pid].initialWager;
                      }
                      return acc;
                    }, {})
                  : null,
            })
          );
          return;
        }
        console.log(`Client ${clientID} requesting to start/join session...`);
        const sessionResult = await sessionManager.startSession(clientID);
        ws.send(JSON.stringify({ type: "sessionStarted", ...sessionResult }));

        console.log(
          `Session start process initiated for ${clientID}. Result from sessionManager:`,
          sessionResult
        );
      } catch (error) {
        console.error(`Error during startSession for ${clientID}:`, error);
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Failed to start session: ${error.message}`,
          })
        );
      }
    } else if (
      data.type === "updateWager" &&
      clientID &&
      data.sessionID &&
      data.wagerType &&
      data.value !== undefined
    ) {
      const sessionID = data.sessionID;
      if (!sessionStates.has(sessionID)) {
        console.warn(
          `Received wager update for inactive/unknown session ${sessionID}`
        );
        ws.send(
          JSON.stringify({ type: "error", message: "Session not active." })
        );
        return;
      }
      const state = sessionStates.get(sessionID);
      let expectedPhase = null;
      let expectedSubPhase = null;
      if (data.wagerType === "initialWager") {
        expectedPhase =
          state.mode === "solo" ? PHASES.INITIAL : PHASES.GROUP_DELIB;
        if (state.mode === "group") expectedSubPhase = "wager";
      } else if (data.wagerType === "finalWager") {
        expectedPhase = PHASES.FINAL_DECISION;
      }

      if (
        state.currentPhase !== expectedPhase ||
        (expectedSubPhase && state.currentSubPhase !== expectedSubPhase)
      ) {
        console.warn(
          `Wager update ${
            data.wagerType
          } received from ${clientID} during incorrect phase: ${
            state.currentPhase
          } (${state.currentSubPhase || ""}). Expected: ${expectedPhase} (${
            expectedSubPhase || ""
          })`
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Cannot update ${data.wagerType} at this time.`,
          })
        );
        return;
      }

      const wagerValue = parseInt(data.value, 10);
      if (isNaN(wagerValue) || wagerValue < 0 || wagerValue > 4) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Invalid wager value (must be 0-4).",
          })
        );
        return;
      }
      updateParticipantData(sessionID, clientID, data.wagerType, wagerValue);
      ws.send(
        JSON.stringify({
          type: "wagerUpdated",
          wagerType: data.wagerType,
          value: wagerValue,
        })
      );
    } else if (
      data.type === "confirmDecision" &&
      clientID &&
      data.sessionID &&
      data.phase
    ) {
      const sessionID = data.sessionID;
      if (sessionStates.has(sessionID)) {
        const state = sessionStates.get(sessionID);
        if (state.participantData[clientID]) {
          let confirmedField = null;
          if (
            state.currentPhase === PHASES.INITIAL &&
            data.phase === PHASES.INITIAL
          )
            confirmedField = "soloInitialConfirmed";
          else if (
            state.currentPhase === PHASES.GROUP_DELIB &&
            state.currentSubPhase === "wager" &&
            data.phase === PHASES.GROUP_DELIB
          )
            confirmedField = "wagerConfirmed";
          else if (
            state.currentPhase === PHASES.FINAL_DECISION &&
            data.phase === PHASES.FINAL_DECISION
          )
            confirmedField = "finalDecisionConfirmed";
          else if (
            state.currentPhase === PHASES.RESULT &&
            data.phase === PHASES.RESULT
          )
            confirmedField = "resultConfirmed";

          if (
            confirmedField &&
            state.participantData[clientID].hasOwnProperty(confirmedField)
          ) {
            state.participantData[clientID][confirmedField] = true;
            console.log(
              `Client ${clientID} confirmed phase ${state.currentPhase} ${
                state.currentSubPhase || ""
              }`
            );
            ws.send(
              JSON.stringify({
                type: "decisionConfirmed",
                phase: state.currentPhase,
                subPhase: state.currentSubPhase,
              })
            );
          } else {
            console.warn(
              `Confirmation received from ${clientID} for phase ${
                data.phase
              }, but server is in ${state.currentPhase} (${
                state.currentSubPhase || ""
              }) or field missing.`
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Confirmation mismatch or invalid.",
              })
            );
          }
        } else {
          console.warn(
            `Client ${clientID} not found in participantData for session ${sessionID} during confirmDecision.`
          );
        }
      } else {
        console.warn(
          `Session ${sessionID} not found during confirmDecision for client ${clientID}.`
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Session not active for confirmation.",
          })
        );
      }
    } else if (
      data.type === "sendData" &&
      data.payload &&
      data.payload.event === "trialData"
    ) {
      const payloadData = data.payload.data;
      const sessionID = payloadData.sessionID;
      const clientID = payloadData.clientID;

      if (sessionID && sessionStates.has(sessionID)) {
        const state = sessionStates.get(sessionID);
        const trialNum = payloadData.trialNumber;

        if (state.trialResults[trialNum]?.[clientID]) {
          console.warn(
            `Trial ${trialNum} data already received from client ${clientID}. Ignoring duplicate.`
          );
          ws.send(
            JSON.stringify({
              type: "info",
              message: "Trial data already received.",
            })
          );
          return;
        }

        if (!state.trialResults[trialNum]) state.trialResults[trialNum] = {};
        state.trialResults[trialNum][clientID] = payloadData;
        sessionStates.set(sessionID, state);
        console.log(
          `Stored trial ${trialNum} data for client ${clientID} in session ${sessionID}`
        );

        try {
          await sessionManager.sendData(data.payload);
          ws.send(JSON.stringify({ type: "dataSent", event: "trialData" }));
        } catch (error) {
          console.error("Error saving trial data via sessionManager:", error);
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Failed to save trial data.",
            })
          );
        }
      } else {
        console.warn(
          `Received trialData for inactive/unknown session ${sessionID} from ${clientID}`
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Session not active for data saving.",
          })
        );
      }
    } else if (
      data.type === "sendData" &&
      data.payload &&
      (data.payload.event === "preTaskSurvey" ||
        data.payload.event === "postTaskSurvey" ||
        data.payload.event === "finishSession")
    ) {
      try {
        if (
          data.payload.event === "finishSession" &&
          clientID &&
          !data.payload.data.sessionID
        ) {
          const sessionID = getClientSession(clientID);
          if (sessionID) data.payload.data.sessionID = sessionID;
        }

        await sessionManager.sendData(data.payload);
        ws.send(
          JSON.stringify({ type: "dataSent", event: data.payload.event })
        );
        console.log(
          `Processed ${data.payload.event} for client ${
            data.payload.data?.clientID || clientID
          }`
        );
      } catch (error) {
        console.error(
          `Error processing ${data.payload.event} via sessionManager:`,
          error
        );
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Failed to process ${data.payload.event}.`,
          })
        );
      }
    } else {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Unknown message type or missing required fields",
          received: data,
        })
      );
      console.log("Unknown message received: ", data);
    }
  });

  ws.on("close", () => {
    let disconnectedClientID = null;
    for (const [clientID, clientWs] of clients.entries()) {
      if (clientWs === ws) {
        disconnectedClientID = clientID;
        clients.delete(clientID);
        clientUserNames.delete(clientID); 
        console.log(`Client disconnected: ${clientID}`);
        break;
      }
    }

    if (disconnectedClientID) {
      const sessionID = getClientSession(disconnectedClientID);
      if (sessionID && sessionStates.has(sessionID)) {
        const state = sessionStates.get(sessionID);
        console.log(
          `Client ${disconnectedClientID} left active session ${sessionID}. Current participants: ${state.participants.join(
            ", "
          )}`
        );
      }
    }
    broadcastParticipantCount();
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    let errorClientID = null;
    for (const [clientID, clientWs] of clients.entries()) {
      if (clientWs === ws) {
        errorClientID = clientID;
        clients.delete(clientID);
        console.log(`Client removed due to error: ${errorClientID}`);
        break;
      }
    }
    if (errorClientID) {
      broadcastParticipantCount();
    }
  });
});
