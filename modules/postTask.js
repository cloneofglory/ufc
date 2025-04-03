// modules/postTask.js
const postTask = (function () {
  let appContainer;
  let postTaskScreen;
  let ws;

  function init(webSocketInstance) {
    appContainer = document.getElementById("app-container");
    ws = webSocketInstance;

    postTaskScreen = document.createElement("div");
    postTaskScreen.classList.add("screen");
    postTaskScreen.innerHTML = `
      <h2>Post-Task Survey</h2>
      <p>Thank you for participating in the UFC Prediction Experiment!</p>
      <p id="final-wallet">Total Winnings: $0</p>
      <div class="form-group">
        <label for="slider-performance">How would you rate your overall performance? (0-100):</label>
        <input type="range" id="slider-performance" min="0" max="100" step="1" value="50">
      </div>
      <div class="form-group">
        <label for="slider-ai-perf">How would you rate the AI's performance? (0-100):</label>
        <input type="range" id="slider-ai-perf" min="0" max="100" step="1" value="50">
      </div>
      <button id="btn-finish">Finish</button>
      <div id="posttask-countdown" style="margin-top: 10px;"></div>
      <div id="thank-you-message" style="display: none; text-align: center; margin-top: 20px;">
          <h2>Thank you for your participation!</h2>
          <button id="btn-home">Go to Home</button>
      </div>
    `;

    appContainer.appendChild(postTaskScreen);

    postTaskScreen
      .querySelector("#btn-finish")
      .addEventListener("click", onFinish);
  }

  function showPostTaskScreen() {
    hideAllScreens();
    postTaskScreen.style.display = "block";
    const finalWallet = utilities.getWallet();
    document.getElementById(
      "final-wallet"
    ).textContent = `Total Winnings: $${finalWallet}`;

    // Start a 10-second countdown
    const countdownEl = document.getElementById("posttask-countdown");
    let remainTime = 10; // countdown duration in seconds
    countdownEl.textContent = `Session ending in ${remainTime} seconds`;

    const countdownInterval = setInterval(() => {
      remainTime--;
      countdownEl.textContent = `Session ending in ${remainTime} seconds`;
      if (remainTime <= 0) {
        clearInterval(countdownInterval);
        finishPostTask();
      }
    }, 1000);
  }

  function onFinish() {
    // Disable the finish button immediately
    const finishBtn = postTaskScreen.querySelector("#btn-finish");
    finishBtn.disabled = true;

    // If not already present, create and append a waiting message
    let waitingMsg = postTaskScreen.querySelector(".waiting-message");
    if (!waitingMsg) {
      waitingMsg = document.createElement("p");
      waitingMsg.className = "waiting-message";
      waitingMsg.innerHTML = "<strong>Waiting for session to end...</strong>";
      postTaskScreen.appendChild(waitingMsg);
    }
  }

  function hideAllScreens() {
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.style.display = "none";
    });
  }

  function finishPostTask() {
    // Capture survey responses
    const performanceVal = postTaskScreen.querySelector(
      "#slider-performance"
    ).value;
    const aiPerfVal = postTaskScreen.querySelector("#slider-ai-perf").value;
    // Save post-task survey data using your utilities module
    utilities.savePostTaskData({ performanceVal, aiPerfVal });

    // Send the finish session payload
    ws.send(
      JSON.stringify({
        type: "sendData",
        payload: {
          event: "finishSession",
          data: { clientID: sessionStorage.getItem("PROLIFIC_PID") },
        },
      })
    );

    // Remove the finish button and waiting message
    const finishBtn = postTaskScreen.querySelector("#btn-finish");
    if (finishBtn) {
      finishBtn.remove();
    }
    const waitingMsg = postTaskScreen.querySelector(".waiting-message");
    if (waitingMsg) {
      waitingMsg.remove();
    }

    // Hide the countdown element
    const countdownEl = document.getElementById("posttask-countdown");
    if (countdownEl) {
      countdownEl.style.display = "none";
    }

    // Alert that the session has ended
    alert("Session ended");

    // Then display the thank-you message with the "Go to Home" button
    const thankYouDiv = document.getElementById("thank-you-message");
    thankYouDiv.style.display = "block";
    thankYouDiv.querySelector("#btn-home").addEventListener("click", () => {
      window.location.reload();
    });
  }

  return {
    init,
    showPostTaskScreen,
  };
})();
