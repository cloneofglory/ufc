const { admin, firestore } = require("./firebaseConfig");
const WAITING_DURATION = 30000; // 30 seconds

const sessionManager = {
  updateCallback: null,
  clientSessions: new Map(), // Map to track which session each client belongs to

  // Allows setting an update callback (e.g., to broadcast session updates)
  setUpdateCallback(callback) {
    this.updateCallback = callback;
  },

  /**
   * Starts or joins a session.
   * Returns an object with { sessionID, waitingEndTime, mode }.
   */
  async startSession(clientID) {
    if (!clientID) {
      throw new Error("clientID is required to start a session.");
    }
    const now = Date.now();
    const waitingSessionDoc = await getWaitingSession();

    if (waitingSessionDoc) {
      const sessionData = waitingSessionDoc.data();
      const createdAtMillis =
        sessionData.createdAt.seconds * 1000 +
        Math.floor(sessionData.createdAt.nanoseconds / 1e6);
      const waitingEndTime = sessionData.waitingEndTime
        ? sessionData.waitingEndTime.toMillis()
        : createdAtMillis + WAITING_DURATION;
      const elapsed = now - createdAtMillis;

      // Case 1: Existing waiting session (not full and within waiting time)
      if (sessionData.participants.length < 3 && elapsed < WAITING_DURATION) {
        if (!sessionData.participants.includes(clientID)) {
          sessionData.participants.push(clientID);
        }
        await waitingSessionDoc.ref.update({
          participants: sessionData.participants,
        });

        // Track this client's session
        this.clientSessions.set(clientID, waitingSessionDoc.id);

        console.log(
          `Added ${clientID} to waiting session ${waitingSessionDoc.id}`
        );

        // If the session is now full (3 participants), update to group mode.
        if (sessionData.participants.length === 3) {
          await waitingSessionDoc.ref.update({
            status: "running",
            mode: "group",
            waitingEndTime: admin.firestore.Timestamp.fromMillis(now),
          });
          console.log(
            `Session ${waitingSessionDoc.id} is now running as a group session.`
          );
          if (this.updateCallback) {
            this.updateCallback({
              sessionID: waitingSessionDoc.id,
              status: "running",
              mode: "group",
              waitingEndTime: now,
            });
          }
          return {
            sessionID: waitingSessionDoc.id,
            waitingEndTime: now,
            mode: "group",
          };
        }
        return {
          sessionID: waitingSessionDoc.id,
          waitingEndTime,
          mode: "waiting",
        };
      }
      // Case 2: Waiting session exists with 2 participants and waiting time elapsed.
      else if (
        sessionData.participants.length >= 2 &&
        elapsed >= WAITING_DURATION
      ) {
        // Get the participants and process them
        const participantsToBeSplit = [...sessionData.participants];

        // If there are 3 or more participants, create a group with first 3
        if (participantsToBeSplit.length >= 3) {
          // Get first 3 participants for group session
          const groupParticipants = participantsToBeSplit.splice(0, 3);

          // Update existing session to be a group session
          await waitingSessionDoc.ref.update({
            status: "running",
            mode: "group",
            participants: groupParticipants,
            waitingEndTime: admin.firestore.Timestamp.fromMillis(now),
          });

          // Update client sessions for group participants
          for (const participant of groupParticipants) {
            this.clientSessions.set(participant, waitingSessionDoc.id);
          }

          // Notify about group session
          if (this.updateCallback) {
            this.updateCallback({
              sessionID: waitingSessionDoc.id,
              status: "running",
              mode: "group",
              waitingEndTime: now,
            });
          }

          // Create solo sessions for remaining participants
          for (const participant of participantsToBeSplit) {
            const soloSessionID = await createSoloSession(participant);
            this.clientSessions.set(participant, soloSessionID);
            console.log(
              `Created solo session ${soloSessionID} for ${participant}`
            );
            if (this.updateCallback) {
              this.updateCallback({
                sessionID: soloSessionID,
                status: "running",
                mode: "solo",
                waitingEndTime: now,
                clientID: participant,
              });
            }
          }

          // Return appropriate session info for the current client
          const currentClientSessionID = this.clientSessions.get(clientID);
          const currentClientMode =
            currentClientSessionID === waitingSessionDoc.id ? "group" : "solo";
          return {
            sessionID: currentClientSessionID,
            waitingEndTime: now,
            mode: currentClientMode,
          };
        } else {
          // Handle case with exactly 2 participants - create solo sessions for both
          for (const participant of participantsToBeSplit) {
            const soloSessionID = await createSoloSession(participant);
            this.clientSessions.set(participant, soloSessionID);
            console.log(
              `Created solo session ${soloSessionID} for ${participant}`
            );
            if (this.updateCallback) {
              this.updateCallback({
                sessionID: soloSessionID,
                status: "running",
                mode: "solo",
                waitingEndTime: now,
                clientID: participant,
              });
            }
          }

          await waitingSessionDoc.ref.update({ status: "ended" });

          // Create solo session for the new client too
          const soloSessionID = await createSoloSession(clientID);
          this.clientSessions.set(clientID, soloSessionID);
          console.log(`Created solo session ${soloSessionID} for ${clientID}`);
          return {
            sessionID: soloSessionID,
            waitingEndTime: now,
            mode: "solo",
          };
        }
      }
      // Fallback: Create a new waiting session.
      else {
        return await createNewWaitingSession(clientID);
      }
    } else {
      // No waiting session exists; create one.
      return await createNewWaitingSession(clientID);
    }
  },

  /**
   * Ends the current session.
   */
  async endSession(sessionID) {
    if (sessionID) {
      const sessionRef = firestore.collection("sessions").doc(sessionID);
      await sessionRef.update({
        status: "ended",
        endedAt: admin.firestore.Timestamp.now(),
      });
      console.log(`Session ${sessionID} ended`);

      // Clear client session mappings for this session
      for (const [clientID, clientSessionID] of this.clientSessions.entries()) {
        if (clientSessionID === sessionID) {
          this.clientSessions.delete(clientID);
        }
      }
    }
  },

  /**
   * Processes incoming data from the client and writes it to the appropriate sub-collection.
   * Supported events: "trialData", "preTaskSurvey", "postTaskSurvey", "finishSession"
   */
  async sendData(payload) {
    // Get the sessionID from clientID if available
    const clientID = payload.data?.clientID;
    const sessionID = clientID ? this.getClientSessionID(clientID) : null;

    if (!sessionID) return;

    const sessionRef = firestore.collection("sessions").doc(sessionID);

    if (payload.event === "trialData") {
      if (payload.data.mode === "group") {
        // For group mode, aggregate individual trial data.
        const trialDocId = `trial_${payload.data.trialNumber}_group`;
        const trialDocRef = sessionRef.collection("trials").doc(trialDocId);
        await firestore.runTransaction(async (transaction) => {
          const doc = await transaction.get(trialDocRef);

          // Clean up duplicate data in payload
          const cleanPayload = {
            ...payload.data,
            aiPrediction: undefined,
            aiRationale: undefined,
          };

          const commonData = {
            trialNumber: cleanPayload.trialNumber,
            mode: "group",
            fighterData: cleanPayload.fighterData,
            chatMessages: doc.exists ? doc.data().chatMessages || [] : [],
          };

          // Add any new chat messages to the trial-level chatMessages
          if (
            cleanPayload.chatMessages &&
            cleanPayload.chatMessages.length > 0
          ) {
            const existingMsgIds = new Set();

            // Create a set of existing message IDs to avoid duplicates
            if (commonData.chatMessages.length > 0) {
              commonData.chatMessages.forEach((msg) => {
                existingMsgIds.add(`${msg.user}_${msg.timestamp}`);
              });
            }

            // Add only new messages
            cleanPayload.chatMessages.forEach((msg) => {
              const msgId = `${msg.user}_${msg.timestamp}`;
              if (!existingMsgIds.has(msgId)) {
                commonData.chatMessages.push(msg);
              }
            });
          }

          let submissions = {};
          if (!doc.exists) {
            submissions[cleanPayload.clientID] = {
              initialWager: cleanPayload.initialWager,
              finalWager: cleanPayload.finalWager,
              timestamp: cleanPayload.timestamp,
            };
            transaction.set(trialDocRef, { ...commonData, submissions });
          } else {
            const existingData = doc.data();
            submissions = existingData.submissions || {};
            submissions[cleanPayload.clientID] = {
              initialWager: cleanPayload.initialWager,
              finalWager: cleanPayload.finalWager,
              timestamp: cleanPayload.timestamp,
            };
            transaction.update(trialDocRef, {
              submissions,
              chatMessages: commonData.chatMessages,
            });
          }
        });
        console.log(payload.data);
        console.log(
          `Aggregated group trial data updated for trial ${payload.data.trialNumber}`
        );
      } else {
        console.log(payload.data);
        // Solo mode: store each trial as a separate document.
        await sessionRef.collection("trials").add(payload.data);
        console.log(
          "Trial data stored in subcollection for session:",
          sessionID
        );
      }
    } else if (payload.event === "preTaskSurvey") {
      // Save pre-task survey under a unique document ID.
      await sessionRef
        .collection("participantData")
        .doc(`${payload.data.clientID}_preTask`)
        .set(payload.data);
      console.log("Pre-task survey data stored for session:", sessionID);
    } else if (payload.event === "postTaskSurvey") {
      // Save post-task survey under a unique document ID.
      await sessionRef
        .collection("participantData")
        .doc(`${payload.data.clientID}_postTask`)
        .set(payload.data);
      console.log("Post-task survey data stored for session:", sessionID);
    } else if (payload.event === "finishSession") {
      // Instead of a simple counter, use an array of finished IDs.
      await sessionRef.update({
        finishedIDs: admin.firestore.FieldValue.arrayUnion(
          payload.data.clientID
        ),
      });
      const sessionSnap = await sessionRef.get();
      const data = sessionSnap.data();
      const finishedIDs = data.finishedIDs || [];
      const totalParticipants = data.participants
        ? data.participants.length
        : 1;
      if (finishedIDs.length >= totalParticipants) {
        await this.endSession(sessionID);
        console.log("All participants finished. Session ended.");
        if (this.updateCallback) {
          this.updateCallback({ sessionID: sessionID, status: "ended" });
        }
      }
    } else {
      console.log("Unknown payload event:", payload.event);
    }
  },

  /**
   * Gets the session ID for a specific client.
   */
  getClientSessionID(clientID) {
    return this.clientSessions.get(clientID) || null;
  },
};

async function getWaitingSession() {
  const sessionsRef = firestore.collection("sessions");
  const querySnapshot = await sessionsRef
    .where("status", "==", "waiting")
    .limit(1)
    .get();
  if (!querySnapshot.empty) {
    return querySnapshot.docs[0];
  }
  return null;
}

async function createNewWaitingSession(clientID) {
  const sessionRef = firestore.collection("sessions").doc();
  const now = Date.now();
  const waitingEndTime = now + WAITING_DURATION;
  const sessionData = {
    createdAt: admin.firestore.Timestamp.now(),
    waitingEndTime: admin.firestore.Timestamp.fromMillis(waitingEndTime),
    endedAt: null,
    participants: [clientID],
    status: "waiting",
    mode: "waiting",
    finishedIDs: [],
  };
  await sessionRef.set(sessionData);
  const sessionID = sessionRef.id;

  // Track this client's session
  sessionManager.clientSessions.set(clientID, sessionID);

  console.log(`Created new waiting session ${sessionID} for ${clientID}`);

  // After WAITING_DURATION, update the session if still waiting.
  setTimeout(async () => {
    const sessionSnap = await sessionRef.get();
    if (sessionSnap.exists) {
      const data = sessionSnap.data();
      if (data.status === "waiting") {
        const nowTimeout = Date.now();

        // Improved logic to handle different participant counts
        if (data.participants.length === 1) {
          // Just one participant - start solo mode
          await sessionRef.update({
            status: "running",
            mode: "solo",
            waitingEndTime: admin.firestore.Timestamp.fromMillis(nowTimeout),
          });
          console.log(`Session ${sessionID} updated to running (solo).`);
          if (sessionManager.updateCallback) {
            sessionManager.updateCallback({
              sessionID: sessionID,
              status: "running",
              mode: "solo",
              waitingEndTime: nowTimeout,
            });
          }
        } else if (data.participants.length === 2) {
          // Create solo sessions for both participants
          for (const participant of data.participants) {
            const soloSessionID = await createSoloSession(participant);
            sessionManager.clientSessions.set(participant, soloSessionID);
            console.log(
              `Created solo session ${soloSessionID} for ${participant}`
            );
            if (sessionManager.updateCallback) {
              sessionManager.updateCallback({
                sessionID: soloSessionID,
                status: "running",
                mode: "solo",
                waitingEndTime: nowTimeout,
                clientID: participant,
              });
            }
          }
          // Mark the waiting session as ended since we've moved participants to solo sessions
          await sessionRef.update({
            status: "ended",
            waitingEndTime: admin.firestore.Timestamp.fromMillis(nowTimeout),
          });
        } else if (data.participants.length >= 3) {
          // 3 or more participants - make first 3 a group, rest go solo
          const allParticipants = [...data.participants];
          const groupParticipants = allParticipants.slice(0, 3);
          const soloParticipants = allParticipants.slice(3);

          // Update current session to group for first 3 participants
          await sessionRef.update({
            status: "running",
            mode: "group",
            participants: groupParticipants,
            waitingEndTime: admin.firestore.Timestamp.fromMillis(nowTimeout),
          });
          console.log(
            `Session ${sessionID} updated to running (group) with ${groupParticipants.length} participants.`
          );

          // Create solo sessions for remaining participants
          for (const participant of soloParticipants) {
            const soloSessionID = await createSoloSession(participant);
            sessionManager.clientSessions.set(participant, soloSessionID);
            console.log(
              `Created solo session ${soloSessionID} for ${participant}`
            );
            if (sessionManager.updateCallback) {
              sessionManager.updateCallback({
                sessionID: soloSessionID,
                status: "running",
                mode: "solo",
                waitingEndTime: nowTimeout,
                clientID: participant,
              });
            }
          }

          // Notify about the group session update
          if (sessionManager.updateCallback) {
            sessionManager.updateCallback({
              sessionID: sessionID,
              status: "running",
              mode: "group",
              waitingEndTime: nowTimeout,
            });
          }
        }
      }
    }
  }, WAITING_DURATION);

  return { sessionID: sessionID, waitingEndTime, mode: "waiting" };
}

async function createSoloSession(clientID) {
  const sessionRef = firestore.collection("sessions").doc();
  const sessionData = {
    createdAt: admin.firestore.Timestamp.now(),
    endedAt: null,
    participants: [clientID],
    status: "running",
    mode: "solo",
  };
  await sessionRef.set(sessionData);
  console.log(`Created solo session ${sessionRef.id} for ${clientID}`);
  return sessionRef.id;
}

module.exports = sessionManager;
