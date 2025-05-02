let trialResults = [];
let groupChatMessages = [];
let initialWager = 2;
let finalWager = 2;
let currentTrial = 1;
let totalTrials = 50;
let isSolo = false;
let currentFightData = null;
let serverAiCorrect = null;
let sessionID = null;
let currentPhase = null;
let currentSubPhase = null;
let phaseStartTime = null;
let phaseDuration = null;
let wagerDuration = null;
let chatDuration = null;
let ws;

let isGroupWagerConfirmed = false;
let finalDecisionConfirmed = false;
let resultConfirmed = false;
let soloInitialConfirmed = false;
let trialDataSaved = false;
let chatInputEnabled = false;
let countdownIntervalId = null;
let autoTransitionTimerId = null;

const trialPhase = (function () {
  let appContainer;
  let initialScreen, groupDelibScreen, finalDecisionScreen, resultScreen;

  function init(webSocketInstance) {
    ws = webSocketInstance;
    appContainer = document.getElementById("app-container");
    buildInitialScreen();
    buildGroupDelibScreen();
    buildFinalDecisionScreen();
    buildResultScreen();

    // Set up WebSocket listener for server messages
    ws.addEventListener("message", handleServerMessage);
  }

  function handleServerMessage(event) {
    try {
      const data = JSON.parse(event.data);

      if (data.type === "sessionStarted" || data.type === "sessionUpdate") {
        if (data.sessionID) sessionID = data.sessionID;
        if (data.mode) isSolo = data.mode === "solo";
        console.log(
          `Session update: ID=${sessionID}, Mode=${
            isSolo ? "Solo" : "Group"
          }, Status=${data.status}`
        );
      } else if (data.type === "phaseChange") {
        clearAllTimers();

        window.aiMode = data.aiMode || null;
        sessionID = data.sessionID || sessionID;
        currentTrial = data.trial;
        totalTrials = data.totalTrials;
        currentPhase = data.phase;
        currentSubPhase = data.subPhase;
        phaseStartTime = data.startTime;
        phaseDuration = data.duration;
        wagerDuration = data.wagerDuration;
        chatDuration = data.chatDuration;

        if (data.trialData) {
          window.currentTrialData = window.currentTrialData || {};
          window.currentTrialData[currentTrial] = data.trialData;
          console.log("Received trial data for trial", currentTrial);
          loadTrialData();
        }

        resetPhaseFlags();
        if (currentPhase !== "result") {
          trialDataSaved = false;
        }

        if (currentPhase === "result" && currentFightData) {
          serverAiCorrect =
            currentFightData.winner ==
            currentFightData.predicted_winner_numeric;
          console.log(`Result phase: Server AI Correct = ${serverAiCorrect}`);
        } else if (currentPhase === "result") {
          console.warn("Result phase started but currentFightData is missing.");
        }

        switch (currentPhase) {
          case "initial":
            showTrialScreenSolo();
            break;
          case "groupDelib":
            showGroupDelibScreen();
            break;
          case "finalDecision":
            showFinalDecisionScreen();
            break;
          case "result":
            showResultScreen();
            break;
        }

        setupDynamicCountdown();
      } else if (data.type === "rejoinSession") {
        clearAllTimers();
        console.log("Rejoining session:", data);

        window.aiMode = data.aiMode || null;
        sessionID = data.sessionID;
        currentTrial = data.trial;
        totalTrials = data.totalTrials;
        currentPhase = data.phase;
        currentSubPhase = data.subPhase;
        isSolo = data.mode === "solo";
        phaseDuration = data.remainingTime;
        phaseStartTime = Date.now();

        if (data.trialData) {
          window.currentTrialData = window.currentTrialData || {};
          window.currentTrialData[currentTrial] = data.trialData;
          console.log("Received trial data on rejoin for trial", currentTrial);
          loadTrialData();
        } else {
          console.warn(
            `Trial data missing on rejoin for trial ${currentTrial}`
          );
        }

        resetPhaseFlags();

        // Show current phase screen
        switch (currentPhase) {
          case "initial":
            showTrialScreenSolo();
            break;
          case "groupDelib":
            showGroupDelibScreen(data.currentWagers);
            break;
          case "finalDecision":
            showFinalDecisionScreen();
            break;
          case "result":
            showResultScreen();
            break;
        }

        setupDynamicCountdown();
      } else if (data.type === "trialsCompleted") {
        clearAllTimers();
        console.log("All trials completed.");
        postTask.showPostTaskScreen();
      } else if (data.type === "allWagersSubmitted" && !isSolo) {
        displayAllConfirmedWagers(data.wagers);
        const wagersDisplay = groupDelibScreen.querySelector(
          "#confirmed-wagers-display"
        );
        if (wagersDisplay) {
          wagersDisplay.style.display = "flex";
        }
      } else if (data.type === "wagerUpdated") {
        console.log(
          `Server confirmed ${data.wagerType} update to ${data.value}`
        );
      } else if (data.type === "dataSent") {
        if (data.event === "trialData") {
          trialDataSaved = true;
        }
      }
    } catch (error) {
      console.error(
        "Error handling WebSocket message:",
        error,
        "Data:",
        event.data
      );
    }
  }

  function resetPhaseFlags() {
    soloInitialConfirmed = currentPhase !== "initial";
    isGroupWagerConfirmed = !(
      currentPhase === "groupDelib" && currentSubPhase === "wager"
    );
    finalDecisionConfirmed = currentPhase !== "finalDecision";
    resultConfirmed = currentPhase !== "result";
    chatInputEnabled =
      currentPhase === "groupDelib" && currentSubPhase === "chat";

    if (currentPhase === "groupDelib" && currentSubPhase === "chat") {
      groupChatMessages = [];
    }
  }

  function clearAllTimers() {
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    if (autoTransitionTimerId) clearTimeout(autoTransitionTimerId);
    countdownIntervalId = null;
    autoTransitionTimerId = null;
  }

  function setupDynamicCountdown() {
    if (countdownIntervalId) clearInterval(countdownIntervalId);

    updateCountdownDisplay();

    countdownIntervalId = setInterval(() => {
      updateCountdownDisplay();
    }, 1000);

    if (autoTransitionTimerId) clearTimeout(autoTransitionTimerId);
    autoTransitionTimerId = setTimeout(() => {
      console.log(
        `Auto-transitioning from ${currentPhase} ${currentSubPhase || ""}`
      );
      handleAutoConfirm();
    }, phaseDuration);
  }

  function updateCountdownDisplay() {
    const now = Date.now();
    const elapsed = now - phaseStartTime;
    const remaining = Math.max(0, phaseDuration - elapsed);
    const seconds = Math.ceil(remaining / 1000);

    let countdownEl = null;
    let textPrefix = "";

    switch (currentPhase) {
      case "initial":
        countdownEl = document.getElementById("solo-initial-countdown");
        textPrefix = "Time remaining:";
        break;
      case "groupDelib":
        countdownEl = document.getElementById("group-countdown");
        if (currentSubPhase === "wager") {
          textPrefix = "Bet time remaining:";
        } else if (currentSubPhase === "chat") {
          textPrefix = "Chat time remaining:";
        }
        break;
      case "finalDecision":
        countdownEl = document.getElementById("final-decision-countdown");
        textPrefix = "Time remaining:";
        break;
      case "result":
        countdownEl = document.getElementById("result-countdown");
        textPrefix = "Next trial in:";
        break;
    }

    if (countdownEl) {
      countdownEl.textContent = `${textPrefix} ${seconds} seconds`;
    }

    if (currentPhase === "groupDelib") {
      const wagerSection = groupDelibScreen.querySelector("#wager-section");
      const chatSection = groupDelibScreen.querySelector("#chat-section");
      const confirmedWagersDisplay = groupDelibScreen.querySelector(
        "#confirmed-wagers-display"
      );

      if (currentSubPhase === "wager") {
        wagerSection.style.display = "block";
        chatSection.style.display = "none";
        if (confirmedWagersDisplay.querySelector(".wager-column")) {
          confirmedWagersDisplay.style.display = "flex";
        } else {
          confirmedWagersDisplay.style.display = "none";
        }
      } else if (currentSubPhase === "chat") {
        wagerSection.style.display = "none";
        chatSection.style.display = "block";
        confirmedWagersDisplay.style.display = "flex";
        enableChatInputUI(true);
      }
    }

    if (remaining <= 0 && countdownIntervalId) {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
      if (countdownEl) countdownEl.textContent = "Time's up!";
    }
  }

  function enableChatInputUI(enable) {
    const chatInput = groupDelibScreen?.querySelector("#chat-input-text");
    const chatSendBtn = groupDelibScreen?.querySelector("#chat-send-btn");
    if (chatInput && chatSendBtn) {
      chatInput.disabled = !enable;
      chatSendBtn.disabled = !enable;
      chatInputEnabled = enable;
    }
  }

  function handleAutoConfirm() {
    console.log(
      `Auto-confirming phase: ${currentPhase} ${currentSubPhase || ""}`
    );
    switch (currentPhase) {
      case "initial":
        if (!soloInitialConfirmed) onConfirmInitial();
        break;
      case "groupDelib":
        if (currentSubPhase === "wager" && !isGroupWagerConfirmed) {
          onConfirmGroupWager();
        }
        break;
      case "finalDecision":
        if (!finalDecisionConfirmed) onConfirmFinalDecision();
        break;
      case "result":
        if (!resultConfirmed) onNextTrial();
        break;
    }
  }

  function buildInitialScreen() {
    initialScreen = document.createElement("div");
    initialScreen.classList.add("screen");
    initialScreen.id = "initial-screen";
    initialScreen.innerHTML = `
      <h2>Trial <span id="solo-trial-number">${currentTrial}</span> of ${totalTrials} - Initial Bet</h2>
      <div id="initial-content"></div>
      <button id="btn-confirm-initial">Confirm Initial Bet</button>
      <div id="solo-initial-countdown"></div>
    `;
    appContainer.appendChild(initialScreen);
    initialScreen
      .querySelector("#btn-confirm-initial")
      .addEventListener("click", onConfirmInitial);
  }

  function onConfirmInitial() {
    if (soloInitialConfirmed) return;
    soloInitialConfirmed = true;

    const wagerSlider = initialScreen.querySelector("#initial-wager-range");
    const confirmButton = initialScreen.querySelector("#btn-confirm-initial");
    initialWager = parseInt(wagerSlider.value, 10);

    wagerSlider.disabled = true;
    confirmButton.disabled = true;
    confirmButton.textContent = "Bet Confirmed";

    console.log(`Solo Initial Bet Confirmed: ${initialWager}`);

    ws.send(
      JSON.stringify({
        type: "updateWager",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        wagerType: "initialWager",
        value: initialWager,
      })
    );
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        phase: "initial",
      })
    );
  }

  function buildGroupDelibScreen() {
    groupDelibScreen = document.createElement("div");
    groupDelibScreen.classList.add("screen");
    groupDelibScreen.id = "group-delib-screen";
    groupDelibScreen.innerHTML = `
      <h2>Group Trial <span id="group-trial-number"></span> - <span id="group-phase-title">Bet Phase</span></h2>
      <div id="group-content">
        <div id="group-fight-info"></div>

        <!-- Wager Section -->
        <div id="wager-section" style="display: none;">
          <h3>Your Bet</h3>
          <div class="wager-slider-container">
            <label for="group-wager-range">Bet Scale (0-4):</label>
            <input type="range" id="group-wager-range" min="0" max="4" step="1" value="2">
          </div>
          <div class="confirm-bet-area">
            <button id="btn-confirm-group-wager">Confirm Bet</button>
          </div>
        </div>

         <!-- Display Area for Confirmed Wagers -->
         <div id="confirmed-wagers-display" class="confirmed-wagers-display" style="display: none;">
             <h3 class="wagers-title">Bet Results</h3>
             <div id="wagers-container" class="wagers-container">
                <!-- Wager columns will be added here by JS -->
                <p style="color: #aaa; width: 100%; text-align: center;">Waiting for all bets...</p> <!-- Placeholder -->
             </div>
         </div>

        <!-- Chat Section -->
        <div id="chat-section" style="display: none;">
           <h3>Group Chat</h3>
           <div class="chat-container" id="chat-messages"></div>
           <div class="chat-input">
             <input type="text" id="chat-input-text" placeholder="Type your opinion..." disabled />
             <button id="chat-send-btn" disabled>Send</button>
           </div>
        </div>

        <div id="group-countdown"></div>
      </div>`;
    appContainer.appendChild(groupDelibScreen);

    groupDelibScreen
      .querySelector("#group-wager-range")
      .addEventListener("input", (e) => {
        if (!isGroupWagerConfirmed) {
          initialWager = parseInt(e.target.value, 10);
        }
      });
    groupDelibScreen
      .querySelector("#btn-confirm-group-wager")
      .addEventListener("click", onConfirmGroupWager);
    groupDelibScreen
      .querySelector("#chat-send-btn")
      .addEventListener("click", onGroupChatSend);
    groupDelibScreen
      .querySelector("#chat-input-text")
      .addEventListener("keypress", function (event) {
        if (event.key === "Enter" && !this.disabled) {
          onGroupChatSend();
        }
      });
  }

  function displayAllConfirmedWagers(wagers) {
    const displayContainer =
      groupDelibScreen.querySelector("#wagers-container");
    const wagersDisplay = groupDelibScreen.querySelector(
      "#confirmed-wagers-display"
    );

    if (!displayContainer) return;

    wagersDisplay.style.display = "flex";

    displayContainer.innerHTML = "";

    const currentUserClientID = sessionStorage.getItem("PROLIFIC_PID");
    const clientIDs = Object.keys(wagers).sort();

    if (clientIDs.length === 0) {
      displayContainer.innerHTML =
        '<p style="color: #aaa; width: 100%; text-align: center;">Waiting for all bets...</p>';
      return;
    }

    clientIDs.forEach((clientID) => {
      const wagerValue = wagers[clientID];
      const isCurrentUser = clientID === currentUserClientID;

      const column = document.createElement("div");
      column.classList.add("wager-column");
      if (isCurrentUser) {
        column.classList.add("my-wager");
      }

      const idElement = document.createElement("div");
      idElement.classList.add("wager-participant-id");
      idElement.textContent = isCurrentUser ? "You" : clientID;

      const valueElement = document.createElement("div");
      valueElement.classList.add("wager-value");
      valueElement.textContent = wagerValue;

      column.appendChild(idElement);
      column.appendChild(valueElement);
      displayContainer.appendChild(column);
    });
  }

  function onGroupChatSend() {
    if (!chatInputEnabled) return;

    const chatInput = groupDelibScreen.querySelector("#chat-input-text");
    const message = chatInput.value.trim();
    if (message) {
      const clientID = sessionStorage.getItem("PROLIFIC_PID");
      const timestamp = new Date().toISOString();

      chat.appendMessage("You", message);

      groupChatMessages.push({
        user: clientID,
        message: message,
        timestamp: timestamp,
      });

      ws.send(
        JSON.stringify({
          type: "chat",
          clientID: clientID,
          sessionID: sessionID,
          message: message,
          timestamp: timestamp,
        })
      );

      chatInput.value = "";
    }
  }

  function onConfirmGroupWager() {
    if (isGroupWagerConfirmed) return;
    isGroupWagerConfirmed = true;

    const wagerSlider = groupDelibScreen.querySelector("#group-wager-range");
    const confirmButton = groupDelibScreen.querySelector(
      "#btn-confirm-group-wager"
    );

    initialWager = parseInt(wagerSlider.value, 10);

    wagerSlider.disabled = true;
    confirmButton.disabled = true;
    confirmButton.textContent = "Bet Confirmed";

    console.log(`Group Initial Bet Confirmed: ${initialWager}`);

    ws.send(
      JSON.stringify({
        type: "updateWager",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        wagerType: "initialWager",
        value: initialWager,
      })
    );
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        phase: "groupDelib",
      })
    );

    const wagersDisplay = groupDelibScreen.querySelector(
      "#confirmed-wagers-display"
    );
    const wagersContainer = groupDelibScreen.querySelector("#wagers-container");

    wagersDisplay.style.display = "flex";

    const myClientID = sessionStorage.getItem("PROLIFIC_PID");
    const tempWagers = {};
    tempWagers[myClientID] = initialWager;

    displayAllConfirmedWagers(tempWagers);

    const waitingMsg = document.createElement("div");
    waitingMsg.className = "waiting-message";
    waitingMsg.textContent = "Your bet confirmed. Waiting for others...";
    wagersContainer.appendChild(waitingMsg);
  }

  function buildFinalDecisionScreen() {
    finalDecisionScreen = document.createElement("div");
    finalDecisionScreen.classList.add("screen");
    finalDecisionScreen.id = "final-decision-screen";
    finalDecisionScreen.innerHTML = `
      <h2>Final Prediction & Bet Confirmation (Trial <span id="final-trial-number"></span> of ${totalTrials})</h2>
      <div id="final-decision-content"></div>
      <button id="btn-confirm-decision">Confirm Final Bet</button>
      <div id="final-decision-countdown"></div>
    `;
    appContainer.appendChild(finalDecisionScreen);
    finalDecisionScreen
      .querySelector("#btn-confirm-decision")
      .addEventListener("click", onConfirmFinalDecision);
  }

  function onConfirmFinalDecision() {
    if (finalDecisionConfirmed) return;
    finalDecisionConfirmed = true;

    const wagerSlider = finalDecisionScreen.querySelector("#final-wager-range");
    const confirmButton = finalDecisionScreen.querySelector(
      "#btn-confirm-decision"
    );
    finalWager = parseInt(wagerSlider.value, 10);

    wagerSlider.disabled = true;
    confirmButton.disabled = true;
    confirmButton.textContent = "Final Bet Confirmed";

    console.log(`Final Bet Confirmed: ${finalWager}`);

    ws.send(
      JSON.stringify({
        type: "updateWager",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        wagerType: "finalWager",
        value: finalWager,
      })
    );
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        phase: "finalDecision",
      })
    );

    const contentEl = finalDecisionScreen.querySelector(
      "#final-decision-content"
    );
    let msgEl = contentEl.querySelector(".confirmation-message");
    if (!msgEl) {
      msgEl = document.createElement("p");
      msgEl.className = "confirmation-message";
      msgEl.style.marginTop = "15px";
      msgEl.style.fontWeight = "bold";
      contentEl.appendChild(msgEl);
    }
    msgEl.innerHTML = "Waiting for results...";
  }

  function buildResultScreen() {
    resultScreen = document.createElement("div");
    resultScreen.classList.add("screen");
    resultScreen.id = "result-screen";
    resultScreen.innerHTML = `
      <h2>Trial <span id="result-trial-number"></span> Outcome</h2>
      <div id="result-content"></div>
      <button id="btn-next-trial">Next Trial</button>
      <div id="result-countdown"></div>
    `;
    appContainer.appendChild(resultScreen);
    resultScreen
      .querySelector("#btn-next-trial")
      .addEventListener("click", onNextTrial);
  }

  function onNextTrial() {
    if (resultConfirmed) return;
    resultConfirmed = true;

    const nextButton = resultScreen.querySelector("#btn-next-trial");
    nextButton.disabled = true;
    nextButton.textContent = "Proceeding...";

    console.log("Proceeding to next trial from Result phase.");

    // Send confirmation to server
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID"),
        sessionID: sessionID,
        phase: "result",
      })
    );
  }

  function showTrialScreenSolo() {
    hideAllScreens();
    if (!initialScreen || !currentFightData) {
      console.error("Initial screen or fight data not ready for solo trial.");
      return;
    }

    initialScreen.querySelector("#solo-trial-number").textContent =
      currentTrial;
    document.getElementById("btn-confirm-initial").disabled = false;
    document.getElementById("btn-confirm-initial").textContent =
      "Confirm Initial Bet";

    initialWager = 2;

    const contentEl = initialScreen.querySelector("#initial-content");
    const wallet = utilities.getWallet();
    contentEl.innerHTML = `
      <p><strong>Wallet:</strong> $${wallet}</p>
      ${generateFighterTableHTML()}
      <p><strong>AI Prediction:</strong> ${currentFightData.aiPrediction}</p>
      ${
        window.aiMode !== "neutralAI"
          ? `<p><strong>Rationale:</strong> ${
              currentFightData.justification || "N/A"
            }</p>`
          : ""
      }
      <div class="wager-slider-container" style="margin-top: 20px;">
        <label for="initial-wager-range">Initial Bet (0-4):</label>
        <input type="range" min="0" max="4" step="1" value="${initialWager}" id="initial-wager-range" />
      </div>
    `;

    const wagerSlider = contentEl.querySelector("#initial-wager-range");
    wagerSlider.disabled = false;
    wagerSlider.value = initialWager;
    wagerSlider.addEventListener("input", (e) => {
      if (!soloInitialConfirmed) initialWager = parseInt(e.target.value, 10);
    });

    initialScreen.style.display = "block";
  }

  function showGroupDelibScreen(rejoinWagers = null) {
    hideAllScreens();
    if (!groupDelibScreen || !currentFightData) {
      return;
    }

    groupDelibScreen.querySelector("#group-trial-number").textContent =
      currentTrial;
    const phaseTitle = groupDelibScreen.querySelector("#group-phase-title");
    const wagerSection = groupDelibScreen.querySelector("#wager-section");
    const chatSection = groupDelibScreen.querySelector("#chat-section");
    const wagerSlider = groupDelibScreen.querySelector("#group-wager-range");
    const confirmButton = groupDelibScreen.querySelector(
      "#btn-confirm-group-wager"
    );
    const confirmedWagersDisplay = groupDelibScreen.querySelector(
      "#confirmed-wagers-display"
    );
    const wagersContainer = groupDelibScreen.querySelector("#wagers-container");

    initialWager = 2;

    const fightInfoEl = groupDelibScreen.querySelector("#group-fight-info");
    const wallet = utilities.getWallet();
    fightInfoEl.innerHTML = `
      <p><strong>Wallet:</strong> $${wallet}</p>
      ${generateFighterTableHTML()}
      <p><strong>AI Prediction:</strong> ${currentFightData.aiPrediction}</p>
      ${
        window.aiMode !== "neutralAI"
          ? `<p><strong>Rationale:</strong> ${
              currentFightData.justification || "N/A"
            }</p>`
          : ""
      }
    `;

    if (currentSubPhase === "wager") {
      phaseTitle.textContent = "Bet Phase";
      wagerSection.style.display = "block";
      chatSection.style.display = "none";

      if (rejoinWagers && Object.keys(rejoinWagers).length > 0) {
        confirmedWagersDisplay.style.display = "flex";
        displayAllConfirmedWagers(rejoinWagers);
      } else {
        confirmedWagersDisplay.style.display = "none";
        wagersContainer.innerHTML =
          '<p style="color: #aaa; width: 100%; text-align: center;">Waiting for all bets...</p>';
      }

      wagerSlider.disabled = false;
      wagerSlider.value = initialWager;
      confirmButton.disabled = false;
      confirmButton.textContent = "Confirm Bet";
      enableChatInputUI(false);

      if (rejoinWagers && Object.keys(rejoinWagers).length > 0) {
        displayAllConfirmedWagers(rejoinWagers);
        const myClientID = sessionStorage.getItem("PROLIFIC_PID");
        if (rejoinWagers[myClientID] !== undefined) {
          isGroupWagerConfirmed = true;
          wagerSlider.value = rejoinWagers[myClientID];
          wagerSlider.disabled = true;
          confirmButton.disabled = true;
          confirmButton.textContent = "Bet Confirmed";
        }
      }
    } else if (currentSubPhase === "chat") {
      phaseTitle.textContent = "Chat Phase";
      wagerSection.style.display = "none";
      chatSection.style.display = "block";
      confirmedWagersDisplay.style.display = "flex";

      groupDelibScreen.querySelector("#chat-messages").innerHTML = "";
      groupDelibScreen.querySelector("#chat-input-text").value = "";
      enableChatInputUI(true);
    } else {
      phaseTitle.textContent = "Processing...";
      wagerSection.style.display = "none";
      chatSection.style.display = "none";
      confirmedWagersDisplay.style.display = "none";
    }

    groupDelibScreen.style.display = "block";
  }

  function showFinalDecisionScreen() {
    hideAllScreens();
    if (!finalDecisionScreen || !currentFightData) {
      console.error("Final decision screen or fight data not ready.");
      return;
    }

    finalDecisionScreen.querySelector("#final-trial-number").textContent =
      currentTrial;
    const confirmButton = finalDecisionScreen.querySelector(
      "#btn-confirm-decision"
    );
    confirmButton.disabled = false;
    confirmButton.textContent = "Confirm Final Bet";

    finalWager = initialWager;

    const contentEl = finalDecisionScreen.querySelector(
      "#final-decision-content"
    );
    const wallet = utilities.getWallet();
    contentEl.innerHTML = `
      <p><strong>Wallet:</strong> ${wallet}</p>
      ${generateFighterTableHTML()}
      <p><strong>AI Prediction:</strong> ${currentFightData.aiPrediction}</p>
      ${
        window.aiMode !== "neutralAI"
          ? `<p><strong>Rationale:</strong> ${
              currentFightData.justification || "N/A"
            }</p>`
          : ""
      }
      <div class="wager-slider-container" style="margin-top: 20px;">
        <label for="final-wager-range">Final Bet (0-4):</label>
        <input type="range" min="0" max="4" step="1" value="${finalWager}" id="final-wager-range" />
      </div>
      <p class="confirmation-message" style="margin-top: 15px; font-weight: bold; display: none;"></p> <!-- Placeholder for confirmation -->
    `;

    const finalWagerSlider = contentEl.querySelector("#final-wager-range");
    finalWagerSlider.disabled = false;
    finalWagerSlider.value = finalWager;
    finalWagerSlider.addEventListener("input", (e) => {
      if (!finalDecisionConfirmed) finalWager = parseInt(e.target.value, 10);
    });

    const msgEl = contentEl.querySelector(".confirmation-message");
    if (msgEl) msgEl.style.display = "none";

    finalDecisionScreen.style.display = "block";
  }

  function showResultScreen() {
    hideAllScreens();
    if (!resultScreen || !currentFightData || serverAiCorrect === null) {
      console.error("Result screen, fight data, or AI correctness not ready.");
      const contentEl = resultScreen?.querySelector("#result-content");
      if (contentEl) contentEl.innerHTML = "<p>Loading results...</p>";
      if (resultScreen) resultScreen.style.display = "block";
      return;
    }

    resultScreen.querySelector("#result-trial-number").textContent =
      currentTrial;
    const nextButton = resultScreen.querySelector("#btn-next-trial");
    nextButton.disabled = false;
    nextButton.textContent = "Next Trial";

    let walletBefore = utilities.getWallet();
    let outcomeText = "";
    let stakeAmount = finalWager;

    if (serverAiCorrect) {
      let winnings = stakeAmount * 2;
      utilities.setWallet(walletBefore - stakeAmount + winnings);
      outcomeText = `AI was correct! You bet ${stakeAmount} and won ${winnings}.`;
    } else {
      utilities.setWallet(walletBefore - stakeAmount);
      outcomeText = `AI was wrong. You bet ${stakeAmount} and lost ${stakeAmount}.`;
    }

    let walletAfter = utilities.getWallet();
    const resultContent = resultScreen.querySelector("#result-content");

    let winnerText = "Unknown";
    if (
      currentFightData.winner !== undefined &&
      currentFightData.winner !== null
    ) {
      winnerText = `Fighter ${currentFightData.winner == 0 ? "B" : "A"} wins`;
    }

    resultContent.innerHTML = `
      <p><strong>Fight Outcome:</strong> ${winnerText}</p>
      <p><strong>AI Prediction was:</strong> ${
        serverAiCorrect
          ? '<span style="color: lightgreen;">Correct</span>'
          : '<span style="color: salmon;">Incorrect</span>'
      }</p>
      <p>${outcomeText}</p>
      <hr style="margin: 10px 0; border-color: #555;">
      <p>Wallet before: ${walletBefore}</p>
      <p><strong>Wallet after: ${walletAfter}</strong></p>
    `;

    resultScreen.style.display = "block";

    if (!trialDataSaved) {
      saveTrialData(walletBefore, walletAfter);
    } else {
      console.log(`Trial ${currentTrial} data already saved.`);
    }
  }

  function saveTrialData(walletBefore, walletAfter) {
    if (trialDataSaved) {
      return;
    }
    if (!currentFightData) {
      return;
    }

    const clientID = sessionStorage.getItem("PROLIFIC_PID");
    const trialDataPayload = {
      trialNumber: currentTrial,
      mode: isSolo ? "solo" : "group",
      fighterData: {
        ...currentFightData,
      },
      initialWager: initialWager,
      finalWager: finalWager,
      chatMessages: isSolo ? [] : groupChatMessages,
      aiCorrect: serverAiCorrect,
      walletBefore: walletBefore,
      walletAfter: walletAfter,
      timestamp: new Date().toISOString(),
      clientID: clientID,
      sessionID: sessionID,
      aiMode: window.aiMode || null,
    };

    trialResults.push(trialDataPayload);

    console.log(`Saving trial ${currentTrial} data:`, trialDataPayload);

    ws.send(
      JSON.stringify({
        type: "sendData",
        payload: { event: "trialData", data: trialDataPayload },
      })
    );
  }

  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((screen) => {
      if (screen) screen.style.display = "none";
    });
  }

  function generateFighterTableHTML() {
    if (!currentFightData) return "<p>Error: Fighter data not loaded.</p>";
    const fa = currentFightData.fighterA || {};
    const fb = currentFightData.fighterB || {};

    return `
    <div class="fighter-table-container">
      <table class="fighter-table">
        <thead>
          <tr>
            <th>Stat</th>
            <th>Fighter A (Red)</th>
            <th>Fighter B (Blue)</th>
          </tr>
         </thead>
         <tbody>
          <tr><td>Career Wins</td><td>${fa.wins ?? "N/A"}</td><td>${
      fb.wins ?? "N/A"
    }</td></tr>
          <tr><td>Career Losses</td><td>${fa.losses ?? "N/A"}</td><td>${
      fb.losses ?? "N/A"
    }</td></tr>
          <tr><td>Age</td><td>${fa.age ? fa.age + " yrs" : "N/A"}</td><td>${
      fb.age ? fb.age + " yrs" : "N/A"
    }</td></tr>
          <tr><td>Height</td><td>${fa.height || "N/A"}</td><td>${
      fb.height || "N/A"
    }</td></tr>
          <tr><td>Strikes Landed/Min</td><td>${fa.strikelaM ?? "N/A"}</td><td>${
      fb.strikelaM ?? "N/A"
    }</td></tr>
          <tr><td>Strike Accuracy</td><td>${fa.sigSacc ?? "N/A"}</td><td>${
      fb.sigSacc ?? "N/A"
    }</td></tr>
          <tr><td>Strike Defense</td><td>${fa.strDef ?? "N/A"}</td><td>${
      fb.strDef ?? "N/A"
    }</td></tr>
          <tr><td>Takedown Accuracy</td><td>${fa.tdAcc ?? "N/A"}</td><td>${
      fb.tdAcc ?? "N/A"
    }</td></tr>
          <tr><td>Takedown Defense</td><td>${fa.tdDef ?? "N/A"}</td><td>${
      fb.tdDef ?? "N/A"
    }</td></tr>
          <tr><td>Strikes Avoided/Min</td><td>${fa.SApM ?? "N/A"}</td><td>${
      fb.SApM ?? "N/A"
    }</td></tr>
         </tbody>
      </table>
    </div>
    `;
  }

  function loadTrialData() {
    const trialDataRow = window.currentTrialData?.[currentTrial];

    if (!trialDataRow) {
      console.error(
        `No trial data found in window.currentTrialData for trial ${currentTrial}`
      );
      currentFightData = null;
      return;
    }

    try {
      const formatPercent = (value) => {
        const num = parseFloat(value);
        return !isNaN(num) ? (num * 100).toFixed(0) + "%" : "N/A";
      };
      const formatAge = (value) => {
        const num = parseInt(value, 10);
        return !isNaN(num) ? Math.floor(num) : null;
      };
      const formatPerMin = (value) => {
        const num = parseFloat(value);
        return !isNaN(num) ? num.toFixed(2) + "/min" : "N/A";
      };

      currentFightData = {
        fighterA: {
          wins: parseInt(trialDataRow.r_wins_total) || 0,
          losses: parseInt(trialDataRow.r_losses_total) || 0,
          age: formatAge(trialDataRow.r_age),
          height: trialDataRow.r_height || "N/A",
          strikelaM: formatPerMin(trialDataRow.r_SLpM_total),
          sigSacc: formatPercent(trialDataRow.r_sig_str_acc_total),
          strDef: formatPercent(trialDataRow.r_str_def_total),
          tdDef: formatPercent(trialDataRow.r_td_def_total),
          SApM: formatPerMin(trialDataRow.r_SApM_total),
          tdAcc: formatPercent(trialDataRow.r_td_acc_total),
        },
        fighterB: {
          wins: parseInt(trialDataRow.b_wins_total) || 0,
          losses: parseInt(trialDataRow.b_losses_total) || 0,
          age: formatAge(trialDataRow.b_age),
          height: trialDataRow.b_height || "N/A",
          strikelaM: formatPerMin(trialDataRow.b_SLpM_total),
          sigSacc: formatPercent(trialDataRow.b_sig_str_acc_total),
          strDef: formatPercent(trialDataRow.b_str_def_total),
          tdDef: formatPercent(trialDataRow.b_td_def_total),
          SApM: formatPerMin(trialDataRow.b_SApM_total),
          tdAcc: formatPercent(trialDataRow.b_td_acc_total),
        },
        predicted_winner_numeric:
          trialDataRow.predicted_winner === "0" ||
          trialDataRow.predicted_winner === 0
            ? 0
            : 1,
        aiPrediction: `Fighter ${
          trialDataRow.predicted_winner === "0" ||
          trialDataRow.predicted_winner === 0
            ? "B (Blue)"
            : "A (Red)"
        } to win`,
        aiRationale: trialDataRow.rationale_feature || "N/A",
        winner:
          trialDataRow.winner !== undefined
            ? parseInt(trialDataRow.winner)
            : null,
        justification: utilities.formatFighterNames(
          trialDataRow.justification || ""
        ),
      };
    } catch (error) {
      console.error(
        "Error processing trial data row:",
        error,
        "Row:",
        trialDataRow
      );
      currentFightData = null;
    }
  }

  return {
    init,
    getTrialResults: () => trialResults,
  };
})();
