let trialResults = [];
let groupChatMessages = [];
let initialWager = 2;
let finalWager = 2;
let currentTrial = 1;
let totalTrials = 50; // For testing (use 50 in production)
let isSolo = false;
let currentFightData = null;
let serverAiCorrect = null; // Outcome provided by server
let sessionID = null;
let currentPhase = null;
let phaseStartTime = null;
let phaseDuration = null; // Default 15 seconds, updated by server
let chatDuration = null;
let ws;

// Track UI state within phases
let isGroupWagerConfirmed = false;
let finalDecisionConfirmed = false;
let resultConfirmed = false;
let soloInitialConfirmed = false;
let trialDataSaved = false;
let chatInputEnabled = true;

const trialPhase = (function () {
  let appContainer;
  let initialScreen, groupDelibScreen, finalDecisionScreen, resultScreen;
  let chatTimerId, wagerTimerId, autoTransitionTimerId;

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

      if (data.type === "sessionStarted") {
        sessionID = data.sessionID;
        isSolo = data.mode === "solo";
        // Reset all confirmation flags when a new session starts
        resetConfirmationFlags();
      } else if (data.type === "phaseChange") {
        // Clear any existing timers when phase changes
        clearAllTimers();

        window.aiMode = data.aiMode || null;

        // Update trial state from server
        currentTrial = data.trial;
        totalTrials = data.totalTrials;
        currentPhase = data.phase;
        phaseStartTime = data.startTime;
        phaseDuration = data.duration;
        chatDuration = data.chatDuration;

        if (data.trialData) {
          if (!window.currentTrialData) {
            window.currentTrialData = [];
          }
          window.currentTrialData[currentTrial - 1] = data.trialData;
          console.log("Received trial data for trial", currentTrial);
        }

        // Reset phase-specific confirmation flags
        resetPhaseFlags(data.phase);

        // Reset trialDataSaved at the start of a new trial
        if (data.phase === "initial" || data.phase === "groupDelib") {
          trialDataSaved = false;
        }

        // Handle phase-specific data (e.g., outcome for result phase)
        if (data.phase === "result" && (data.trialData.winner !== undefined || data.trialData.predicted_winner !== undefined)) {
          serverAiCorrect = data.trialData.winner === data.trialData.predicted_winner;
          trialDataSaved = false; // Reset for the new result
        }

        // Display the appropriate screen
        switch (data.phase) {
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

        // Set up countdown for UI feedback and auto-transition
        setupCountdownDisplay();
        setupAutoTransition(data.phase, data.duration);
      } else if (data.type === "rejoinSession") {
        // Clear any existing timers when rejoining
        clearAllTimers();

        window.aiMode = data.aiMode || null;

        // Rejoin an active session
        sessionID = data.sessionID;
        currentTrial = data.trial;
        totalTrials = data.totalTrials;
        currentPhase = data.phase;
        isSolo = data.mode === "solo";
        phaseStartTime = Date.now() - (phaseDuration - data.remainingTime);

        // Reset phase-specific confirmation flags
        resetPhaseFlags(data.phase);

        // Show current phase screen
        switch (data.phase) {
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

        // Set up countdown and auto-transition
        setupCountdownDisplay();
        setupAutoTransition(data.phase, data.remainingTime);
      } else if (data.type === "trialsCompleted") {
        // Clear any existing timers
        clearAllTimers();
        // Show post-task survey when all trials are done
        postTask.showPostTaskScreen();
      } else if (data.type === "chat") {
        // Append chat messages from other participants
        const chatMessage = {
          user: data.clientID,
          message: data.message,
          timestamp: new Date().toISOString(),
        };
        groupChatMessages.push(chatMessage);
      } else if (data.type === "wagerConfirmed") {
        appendConfirmedWager(data.clientID, data.wager);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  }

  function resetConfirmationFlags() {
    isGroupWagerConfirmed = false;
    finalDecisionConfirmed = false;
    resultConfirmed = false;
    soloInitialConfirmed = false;
    trialDataSaved = false;
    chatInputEnabled = true;
  }

  function resetPhaseFlags(phase) {
    switch (phase) {
      case "initial":
        soloInitialConfirmed = false;
        break;
      case "groupDelib":
        isGroupWagerConfirmed = false;
        chatInputEnabled = true;
        groupChatMessages = [];
        break;
      case "finalDecision":
        finalDecisionConfirmed = false;
        break;
      case "result":
        resultConfirmed = false;
        break;
    }
  }

  function clearAllTimers() {
    if (chatTimerId) clearTimeout(chatTimerId);
    if (wagerTimerId) clearTimeout(wagerTimerId);
    if (autoTransitionTimerId) clearTimeout(autoTransitionTimerId);
  }

  function setupCountdownDisplay() {
    const countdownInterval = setInterval(() => {
      let elapsed = Date.now() - phaseStartTime;
      let chatRemaining =
        chatDuration !== null ? Math.max(0, chatDuration - elapsed) : null;
      let phaseRemaining = Math.max(0, phaseDuration - elapsed);

      if (currentPhase === "groupDelib") {
        if (chatInputEnabled && chatRemaining > 0) {
          updateCountdownDisplay(chatRemaining);
        } else {
          if (chatInputEnabled) {
            disableChatInput();
            groupDelibScreen.querySelector("#wager-section").style.display =
              "block";
            groupDelibScreen.querySelector("#wager-container").style.display =
              "block";
            groupDelibScreen
              .querySelector("#wager-section")
              .scrollIntoView({ behavior: "smooth" });
          }
          updateCountdownDisplay(phaseRemaining);
        }
      } else {
        updateCountdownDisplay(phaseRemaining);
      }

      if (phaseRemaining <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);
  }

  function setupAutoTransition(phase, duration) {
    // Clear any existing auto-transition timer
    if (autoTransitionTimerId) {
      clearTimeout(autoTransitionTimerId);
    }

    // Set auto-transition based on phase
    autoTransitionTimerId = setTimeout(() => {
      switch (phase) {
        case "initial":
          if (!soloInitialConfirmed) onConfirmInitial();
          break;
        case "groupDelib":
          if (!isGroupWagerConfirmed) onConfirmGroupWager();
          break;
        case "finalDecision":
          if (!finalDecisionConfirmed) onConfirmFinalDecision();
          break;
        case "result":
          // No action needed - server will handle transition
          break;
      }
    }, duration);

    // If in group deliberation, set up chat to wager timer
    if (phase === "groupDelib" && !isSolo && chatDuration !== null) {
      // Initially hide the wager container
      groupDelibScreen.querySelector("#wager-container").style.display = "none";

      // Enable chat at the beginning of the group phase
      enableChatInput();
      // Set timer to disable chat and show wager input after the phase time
      chatTimerId = setTimeout(() => {
        if (currentPhase === "groupDelib") {
          disableChatInput();
          groupDelibScreen.querySelector("#wager-container").style.display =
            "block";
        }
      }, chatDuration);
    }
  }

  function enableChatInput() {
    chatInputEnabled = true;
    const chatInput = groupDelibScreen.querySelector("#chat-input-text");
    const chatSendBtn = groupDelibScreen.querySelector("#chat-send-btn");

    chatInput.disabled = false;
    chatSendBtn.disabled = false;
  }

  function disableChatInput() {
    if (!chatInputEnabled) return;
    chatInputEnabled = false;

    const chatInput = groupDelibScreen.querySelector("#chat-input-text");
    const chatSendBtn = groupDelibScreen.querySelector("#chat-send-btn");

    // Add visual indication that chat time is over
    chatInput.disabled = true;
    chatSendBtn.disabled = true;

    // Add message to chat
    const timeUpMessage = document.createElement("div");
    timeUpMessage.className = "system-message";
    timeUpMessage.textContent = "Chat time is up. Please finalize your wager.";
    groupDelibScreen.querySelector("#chat-messages").appendChild(timeUpMessage);

    // Focus on wager section
    groupDelibScreen.querySelector("#wager-section").style.display = "block";
    groupDelibScreen.querySelector("#wager-container").style.display = "block";
    groupDelibScreen
      .querySelector("#wager-section")
      .scrollIntoView({ behavior: "smooth" });
  }

  function updateCountdownDisplay(remainingTime) {
    const seconds = Math.ceil(remainingTime / 1000);

    switch (currentPhase) {
      case "initial":
        const soloCountdownEl = document.getElementById(
          "solo-initial-countdown"
        );
        if (soloCountdownEl)
          soloCountdownEl.textContent = `Time remaining: ${seconds} seconds`;
        break;
      case "groupDelib":
        const groupCountdownEl = document.getElementById(
          "group-initial-countdown"
        );
        if (groupCountdownEl) {
          // Show different message based on whether we're in chat or wager phase
          if (chatInputEnabled && chatDuration !== null) {
            groupCountdownEl.textContent = `Chat time remaining: ${seconds} seconds`;
          } else {
            groupCountdownEl.textContent = `Wager time remaining: ${seconds} seconds`;
          }
        }
        break;
      case "finalDecision":
        const finalCountdownEl = document.getElementById(
          "final-decision-countdown"
        );
        if (finalCountdownEl)
          finalCountdownEl.textContent = `Time remaining: ${seconds} seconds`;
        break;
      case "result":
        const resultCountdownEl = document.getElementById("result-countdown");
        if (resultCountdownEl)
          resultCountdownEl.textContent = `Moving to next trial in ${seconds} seconds`;
        break;
    }
  }

  function buildInitialScreen() {
    initialScreen = document.createElement("div");
    initialScreen.classList.add("screen");
    initialScreen.innerHTML = `
      <h2>Trial <span id="solo-trial-number">${currentTrial}</span> of ${totalTrials} - Initial Stage</h2>
      <div id="initial-content"></div>
      <button id="btn-confirm-initial">Confirm Initial Bet</button>
    `;
    appContainer.appendChild(initialScreen);
    initialScreen
      .querySelector("#btn-confirm-initial")
      .addEventListener("click", onConfirmInitial);
  }

  function onConfirmInitial() {
    if (soloInitialConfirmed) return; // Prevent multiple submissions
    soloInitialConfirmed = true;

    const wagerSlider = initialScreen.querySelector("#initial-wager-range");
    initialWager = parseInt(wagerSlider.value, 10);
    wagerSlider.disabled = true;
    document.getElementById("btn-confirm-initial").disabled = true;

    // Append confirmation message
    const contentEl = initialScreen.querySelector("#initial-content");
    const movingMsgEl = document.createElement("p");
    movingMsgEl.innerHTML = `<strong>Bet confirmed: ${initialWager}.</strong>`;
    contentEl.appendChild(movingMsgEl);

    ws.send(
      JSON.stringify({
        type: "updateWager",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        wagerType: "initialWager",
        value: initialWager,
      })
    );
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        phase: "initial",
      })
    );
  }

  function buildGroupDelibScreen() {
    groupDelibScreen = document.createElement("div");
    groupDelibScreen.classList.add("screen");
    groupDelibScreen.innerHTML = `
      <h2>Group Deliberation - Trial <span id="group-trial-number"></span></h2>
      <div id="group-content">
        <div id="group-fight-info"></div>
        <div id="chat-section">
          <h3>Your Opinion</h3>
          <div class="chat-container" id="chat-messages"></div>
          <div class="chat-input" style="display: block;">
            <input type="text" id="chat-input-text" placeholder="Type your opinion..." />
            <button id="chat-send-btn">Send</button>
          </div>
        </div>
        <hr>
        <div id="wager-section">
          <h3>Your Wager</h3>
          <div id="wager-container" style="display:none; margin-top: 20px;">
            <label for="group-wager-range">Wager Scale (0-4):</label>
            <input type="range" id="group-wager-range" min="0" max="4" step="1" value="2">
            <button id="btn-confirm-group-wager">Confirm Wager</button>
          </div>
        </div>
        <div id="confirmed-wagers" style="margin-top:20px;"></div>
        <div id="group-initial-countdown" style="margin-top:10px;"></div>
      </div>
    `;
    appContainer.appendChild(groupDelibScreen);
    groupDelibScreen
      .querySelector("#chat-send-btn")
      .addEventListener("click", onGroupChatSend);
    groupDelibScreen
      .querySelector("#btn-confirm-group-wager")
      .addEventListener("click", onConfirmGroupWager);

    // Add event listener for wager slider
    groupDelibScreen
      .querySelector("#group-wager-range")
      .addEventListener("input", (e) => {
        initialWager = parseInt(e.target.value, 10);
      });
  }

  function appendConfirmedWager(clientID, wager) {
    const currentUserID = sessionStorage.getItem("PROLIFIC_PID") || "unknown";
    const userLabel = clientID === currentUserID ? "Your" : clientID;
    const confirmedWagersEl =
      groupDelibScreen.querySelector("#confirmed-wagers");
    const wagerEl = document.createElement("p");
    wagerEl.textContent = `${userLabel} wager: ${wager}`;
    confirmedWagersEl.appendChild(wagerEl);
  }

  function onGroupChatSend() {
    const chatInput = groupDelibScreen.querySelector("#chat-input-text");
    const message = chatInput.value.trim();
    if (message) {
      chat.sendMessage(message);
      chat.appendMessage("You", message);
      chatInput.value = "";

      // Optionally force wager display earlier if first message is sent
      if (groupChatMessages.length === 1) {
        // If this is the first message, consider starting the wager timer
        // (similar to original behavior where first message could trigger wager display)
        if (chatTimerId) {
          clearTimeout(chatTimerId);
          chatTimerId = setTimeout(() => {
            disableChatInput();
          }, Math.min(5000, phaseDuration / 2)); // Shorten time after first message
        }
      }
    }
  }

  function onConfirmGroupWager() {
    if (isGroupWagerConfirmed) return; // Prevent multiple confirmations
    isGroupWagerConfirmed = true;

    const wagerSlider = groupDelibScreen.querySelector("#group-wager-range");
    initialWager = parseInt(wagerSlider.value, 10);
    wagerSlider.disabled = true;
    groupDelibScreen.querySelector("#btn-confirm-group-wager").disabled = true;

    ws.send(
      JSON.stringify({
        type: "updateWager",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        wagerType: "initialWager",
        value: initialWager,
      })
    );
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        phase: "groupDelib",
      })
    );
  }

  function buildFinalDecisionScreen() {
    finalDecisionScreen = document.createElement("div");
    finalDecisionScreen.classList.add("screen");
    finalDecisionScreen.innerHTML = `
      <h2>Final Prediction & Bet Confirmation (Trial <span id="trial-number"></span> of ${totalTrials})</h2>
      <div id="final-decision-content"></div>
      <button id="btn-confirm-decision">Final Bet</button>
    `;
    appContainer.appendChild(finalDecisionScreen);
    finalDecisionScreen
      .querySelector("#btn-confirm-decision")
      .addEventListener("click", onConfirmFinalDecision);
  }

  function onConfirmFinalDecision() {
    if (finalDecisionConfirmed) return; // Prevent multiple confirmations
    finalDecisionConfirmed = true;

    const wagerSlider = finalDecisionScreen.querySelector("#final-wager-range");
    finalWager = parseInt(wagerSlider.value, 10);
    wagerSlider.disabled = true;
    finalDecisionScreen.querySelector("#btn-confirm-decision").disabled = true;

    // Display confirmation message
    const contentEl = finalDecisionScreen.querySelector(
      "#final-decision-content"
    );
    const movingMsgEl = document.createElement("p");
    movingMsgEl.innerHTML =
      "<strong>Bet confirmed. Waiting for results...</strong>";
    contentEl.appendChild(movingMsgEl);

    ws.send(
      JSON.stringify({
        type: "updateWager",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        wagerType: "finalWager",
        value: finalWager,
      })
    );
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        phase: "finalDecision",
      })
    );
  }

  function buildResultScreen() {
    resultScreen = document.createElement("div");
    resultScreen.classList.add("screen");
    resultScreen.innerHTML = `
      <h2>Fight Outcome</h2>
      <div id="result-content"></div>
      <button id="btn-next-trial" style="display:none;">Next Trial</button>
    `;
    appContainer.appendChild(resultScreen);
    resultScreen
      .querySelector("#btn-next-trial")
      .addEventListener("click", onNextTrial);
  }

  function onNextTrial() {
    if (resultConfirmed) return; // Prevent multiple clicks
    resultConfirmed = true;

    const nextButton = resultScreen.querySelector("#btn-next-trial");
    nextButton.disabled = true;

    // Add a message to indicate we're proceeding
    const resultContent = resultScreen.querySelector("#result-content");
    const movingMsg = document.createElement("p");
    movingMsg.innerHTML = "<strong>Moving to next trial...</strong>";
    resultContent.appendChild(movingMsg);

    // Send confirmation to server
    ws.send(
      JSON.stringify({
        type: "confirmDecision",
        clientID: sessionStorage.getItem("PROLIFIC_PID") || "unknown",
        sessionID: sessionID,
        phase: "result",
      })
    );
  }

  function showTrialScreenSolo() {
    hideAllScreens();
    initialScreen.querySelector("#solo-trial-number").textContent =
      currentTrial;
    loadTrialData();

    // Reset the initialWager to midpoint (2) for each new trial
    initialWager = 2;

    const contentEl = initialScreen.querySelector("#initial-content");
    const wallet = utilities.getWallet();
    contentEl.innerHTML = `
  <p><strong>Wallet:</strong> ${wallet}</p>
  ${generateFighterTableHTML()}
  <p><strong>AI Prediction:</strong> ${currentFightData.aiPrediction}</p>
  ${window.aiMode !== "neutralAI"
        ? `
  <p><strong>Rationale:</strong> ${currentFightData.justification}</p>
  `
        : ""
      }
  <div style="margin-top: 20px;">
    <label>Initial Bet (0-4):</label>
    <input type="range" min="0" max="4" step="1" value="2" id="initial-wager-range" />
  </div>
  <div id="solo-initial-countdown" style="margin-top:10px;"></div>
`;

    // Add event listener for wager slider
    const wagerSlider = contentEl.querySelector("#initial-wager-range");
    wagerSlider.addEventListener("input", (e) => {
      initialWager = parseInt(e.target.value, 10);
    });

    document.getElementById("btn-confirm-initial").disabled = false;
    initialScreen.style.display = "block";
  }

  function showGroupDelibScreen() {
    groupDelibScreen.querySelector("#wager-section").style.display = "none";
    hideAllScreens();
    groupDelibScreen.querySelector("#group-trial-number").textContent =
      currentTrial;
    loadTrialData();

    // Reset the initialWager to midpoint (2) for each new trial
    initialWager = 2;

    const fightInfoEl = groupDelibScreen.querySelector("#group-fight-info");
    const wallet = utilities.getWallet();
    fightInfoEl.innerHTML = `
    <p><strong>Wallet:</strong> ${wallet}</p>
    ${generateFighterTableHTML()}
    <p><strong>AI Prediction:</strong> ${currentFightData.aiPrediction}</p>
    ${window.aiMode !== "neutralAI"
        ? `
    <p><strong>Rationale:</strong> ${currentFightData.justification}</p>
    `
        : ""
      }
  `;

    // Reset the chat UI
    groupDelibScreen.querySelector("#chat-messages").innerHTML = "";
    groupDelibScreen.querySelector("#confirmed-wagers").innerHTML = "";

    // Reset wager UI to midpoint (2)
    const wagerSlider = groupDelibScreen.querySelector("#group-wager-range");
    wagerSlider.value = 2;
    wagerSlider.disabled = false;
    groupDelibScreen.querySelector("#btn-confirm-group-wager").disabled = false;

    // Reset chat messages array for this new phase
    groupChatMessages = [];
    chatInputEnabled = true;

    groupDelibScreen.style.display = "block";
  }

  function showFinalDecisionScreen() {
    hideAllScreens();
    finalDecisionScreen.querySelector("#trial-number").textContent =
      currentTrial;
    const contentEl = finalDecisionScreen.querySelector(
      "#final-decision-content"
    );
    const wallet = utilities.getWallet();
    contentEl.innerHTML = `
  <p><strong>Wallet:</strong> ${wallet}</p>
  ${generateFighterTableHTML()}
    <p><strong>AI Prediction:</strong> ${currentFightData.aiPrediction}</p>
  ${window.aiMode !== "neutralAI"
        ? `
  <p><strong>Rationale:</strong> ${currentFightData.justification}</p>
  `
        : ""
      }
  <div style="margin-top: 20px;">
    <label>Final Bet (0-4):</label>
    <input type="range" min="0" max="4" step="1" value="${initialWager}" id="final-wager-range" />
  </div>
  <div id="final-decision-countdown" style="margin-top:10px;"></div>
`;

    // Set finalWager to match initialWager initially
    finalWager = initialWager;

    // Add event listener for wager slider
    const finalWagerSlider = contentEl.querySelector("#final-wager-range");
    finalWagerSlider.addEventListener("input", (e) => {
      finalWager = parseInt(e.target.value, 10);
    });

    finalDecisionScreen.querySelector("#btn-confirm-decision").disabled = false;
    finalDecisionScreen.style.display = "block";
  }

  function showResultScreen() {
    hideAllScreens();
    let walletBefore = utilities.getWallet();
    let outcomeText = "";
    let stakeAmount = finalWager;

    if (serverAiCorrect) {
      let winnings = stakeAmount * 2;
      utilities.setWallet((walletBefore - stakeAmount) + winnings);
      outcomeText = `AI was correct! You win $${winnings}.`;
    } else {
      utilities.setWallet(walletBefore - stakeAmount);
      outcomeText = `AI was wrong. You lose $${stakeAmount}.`;
    }

    let walletAfter = utilities.getWallet();
    const resultContent = resultScreen.querySelector("#result-content");
    resultContent.innerHTML = `
      <p><strong>Fight Outcome:</strong> Fighter ${currentFightData.winner === "0" || currentFightData.winner === 0 ? "B" : "A"} wins</p>
      <p>${outcomeText}</p>
      <p>Your new wallet balance is: $${walletAfter}</p>
      <div id="result-countdown" style="margin-top:10px;"></div>
    `;

    // Show the Next Trial button
    const nextButton = resultScreen.querySelector("#btn-next-trial");
    nextButton.style.display = "block";
    nextButton.disabled = false;

    resultScreen.style.display = "block";

    // Save trial data if not already saved
    if (!trialDataSaved) {
      saveTrialData(walletBefore, walletAfter);
    }
  }

  function saveTrialData(walletBefore, walletAfter) {
    if (trialDataSaved) return; // Prevent duplicate saving
    trialDataSaved = true;

    const clientID = sessionStorage.getItem("PROLIFIC_PID") || "unknown";
    const trialData = {
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
    };
    trialResults.push(trialData);
    console.log("Trial data saved locally:", trialData);
    ws.send(
      JSON.stringify({
        type: "sendData",
        payload: { event: "trialData", data: trialData },
      })
    );
  }

  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.style.display = "none";
    });
  }

  function generateFighterTableHTML() {
    return `
    <div class="fighter-table-container">
      <table class="fighter-table">
        <tr>
          <th></th>
          <th>Fighter A</th>
          <th>Fighter B</th>
        </tr>
        <tr>
          <td>Career Wins</td>
          <td>${currentFightData.fighterA.wins}</td>
          <td>${currentFightData.fighterB.wins}</td>
        </tr>
        <tr>
          <td>Career Losses</td>
          <td>${currentFightData.fighterA.losses}</td>
          <td>${currentFightData.fighterB.losses}</td>
        </tr>
        <tr>
          <td>Age</td>
          <td>${currentFightData.fighterA.age} years</td>
          <td>${currentFightData.fighterB.age} years</td>
        </tr>
        <tr>
          <td>Height</td>
          <td>${currentFightData.fighterA.height}</td>
          <td>${currentFightData.fighterB.height}</td>
        </tr>
        <tr>
          <td>Strikes Landed/Min</td>
          <td>${currentFightData.fighterA.strikelaM}</td>
          <td>${currentFightData.fighterB.strikelaM}</td>
        </tr>
        <tr>
          <td>Strike Accuracy</td>
          <td>${currentFightData.fighterA.sigSacc}</td>
          <td>${currentFightData.fighterB.sigSacc}</td>
        </tr>
        <tr>
          <td>Strike Defense</td>
          <td>${currentFightData.fighterA.strDef || "N/A"}</td>
          <td>${currentFightData.fighterB.strDef || "N/A"}</td>
        </tr>
        <tr>
          <td>Takedown Defense</td>
          <td>${currentFightData.fighterA.tdDef || "N/A"}</td>
          <td>${currentFightData.fighterB.tdDef || "N/A"}</td>
        </tr>
        <tr>
          <td>Strikes Avoided/Min</td>
          <td>${currentFightData.fighterA.SApM || "N/A"}</td>
          <td>${currentFightData.fighterB.SApM || "N/A"}</td>
        </tr>
        <tr>
          <td>Takedown Accuracy</td>
          <td>${currentFightData.fighterA.tdAcc || "N/A"}</td>
          <td>${currentFightData.fighterB.tdAcc || "N/A"}</td>
        </tr>
      </table>
    </div>
    `;
  }

  function loadTrialData() {
    if (window.currentTrialData && window.currentTrialData[currentTrial - 1]) {
      try {
        const trialDataRow = window.currentTrialData[currentTrial - 1];

        currentFightData = {
          fighterA: {
            wins: trialDataRow.r_wins_total || 0,
            losses: trialDataRow.r_losses_total || 0,
            age: Math.floor(trialDataRow.r_age || 0),
            height: trialDataRow.r_height || "N/A",
            strikelaM: trialDataRow.r_SLpM_total + "/min" || "N/A",
            sigSacc: (trialDataRow.r_sig_str_acc_total * 100).toFixed(0) + "%" || "N/A",
            strDef: (trialDataRow.r_str_def_total * 100).toFixed(0) + "%" || "N/A",
            tdDef: (trialDataRow.r_td_def_total * 100).toFixed(0) + "%" || "N/A",
            SApM: trialDataRow.r_SApM_total + "/min" || "N/A",
            tdAcc: (trialDataRow.r_td_acc_total * 100).toFixed(0) + "%" || "N/A",
          },
          fighterB: {
            wins: trialDataRow.b_wins_total || 0,
            losses: trialDataRow.b_losses_total || 0,
            age: Math.floor(trialDataRow.b_age || 0),
            height: trialDataRow.b_height || "N/A",
            strikelaM: trialDataRow.b_SLpM_total + "/min" || "N/A",
            sigSacc: (trialDataRow.b_sig_str_acc_total * 100).toFixed(0) + "%" || "N/A",
            strDef: (trialDataRow.b_str_def_total * 100).toFixed(0) + "%" || "N/A",
            tdDef: (trialDataRow.b_td_def_total * 100).toFixed(0) + "%" || "N/A",
            SApM: trialDataRow.b_SApM_total + "/min" || "N/A",
            tdAcc: (trialDataRow.b_td_acc_total * 100).toFixed(0) + "%" || "N/A",
          },
          aiPrediction:
            "Fighter " +
            (trialDataRow.predicted_winner === "0" ||
              trialDataRow.predicted_winner === 0
              ? "B"
              : "A") +
            " will win",
          aiRationale: trialDataRow.rationale_feature || "",
          winner: trialDataRow.winner,
          justification: utilities.formatFighterNames(trialDataRow.justification) || "",
        };

        console.log("Loaded trial data from server for trial", currentTrial);
      } catch (error) {
        console.error("Error parsing server trial data:", error);
      }
    } else {
      console.log("No server trial data available for trial", currentTrial);
    }
  }

  return {
    init,
    setMode: (soloMode) => {
      isSolo = soloMode;
    },
    getTrialResults: () => trialResults,
  };
})();