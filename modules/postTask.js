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
      <p>Thank you for participating in the UFC Prediction Experiment!</p><br/>
      <p id="final-wallet">Total Winnings: $0</p><br/>
  
      <p>Now that you've completed the task, please rate how important you believe each of the following fighter stats actually is in predicting UFC fight outcomes.</p><br/>
      <p>Use the sliders to assign values between 1 (Not important at all) and 100 (Extremely important).</p><br/>
      <p>Base your ratings on what you've learned or noticed during the task.</p><br/>
  
      <div class="feature-sliders">
        <div class="slider-group">
          <label>Career Wins (Total number of fights the fighter has won)</label>
          <input type="range" id="post-slider-wins" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Career Losses (Total number of fights the fighter has lost)</label>
          <input type="range" id="post-slider-losses" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Age (The fighter’s current age in years)</label>
          <input type="range" id="post-slider-age" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Height (The fighter’s height, which can affect reach and leverage)</label>
          <input type="range" id="post-slider-height" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Strikes Landed/Minute (Average number of strikes the fighter lands per minute)</label>
          <input type="range" id="post-slider-slpm" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Strike Accuracy (Percentage of strikes that land successfully)</label>
          <input type="range" id="post-slider-accuracy" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Strike Defense (Percentage of opponent strikes the fighter avoids)</label>
          <input type="range" id="post-slider-defense" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Takedown Defense (Percentage of opponent takedown attempts successfully defended)</label>
          <input type="range" id="post-slider-td-defense" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Strikes Avoided/Minute (Average number of strikes the fighter avoids per minute)</label>
          <input type="range" id="post-slider-sapm" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
  
        <div class="slider-group">
          <label>Takedown Accuracy (Percentage of takedown attempts that are successful)</label>
          <input type="range" id="post-slider-td-accuracy" min="1" max="100" value="50" />
          <span class="slider-value">50</span>
        </div>
      </div>
  
      <button id="btn-finish">Finish</button>
      <div id="posttask-countdown" style="margin-top: 10px;"></div>
      <div id="thank-you-message" style="display: none; text-align: center; margin-top: 20px;">
        <h2>Thank you for your participation!</h2>
        <button id="btn-home">Go to Home</button>
      </div>
    `;
  
    appContainer.appendChild(postTaskScreen);
  
    postTaskScreen.querySelectorAll('input[type="range"]').forEach((slider) => {
      const valueDisplay = slider.nextElementSibling;
      slider.addEventListener("input", () => {
        valueDisplay.textContent = slider.value;
      });
    });

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

    const countdownEl = document.getElementById("posttask-countdown");
    let remainTime = 30; // countdown duration in seconds
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
    const postTaskData = {
      clientID: sessionStorage.getItem("PROLIFIC_PID"),
      finalWallet: utilities.getWallet(),
      timestamp: new Date().toISOString(),
      wins: parseInt(postTaskScreen.querySelector("#post-slider-wins").value),
      losses: parseInt(
        postTaskScreen.querySelector("#post-slider-losses").value
      ),
      age: parseInt(postTaskScreen.querySelector("#post-slider-age").value),
      height: parseInt(
        postTaskScreen.querySelector("#post-slider-height").value
      ),
      slpm: parseInt(postTaskScreen.querySelector("#post-slider-slpm").value),
      accuracy: parseInt(
        postTaskScreen.querySelector("#post-slider-accuracy").value
      ),
      defense: parseInt(
        postTaskScreen.querySelector("#post-slider-defense").value
      ),
      tdDefense: parseInt(
        postTaskScreen.querySelector("#post-slider-td-defense").value
      ),
      sapm: parseInt(postTaskScreen.querySelector("#post-slider-sapm").value),
      tdAccuracy: parseInt(
        postTaskScreen.querySelector("#post-slider-td-accuracy").value
      ),
    };
    utilities.savePostTaskData(postTaskData);

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