your-project/
├── index.html              // Main HTML file that loads CSS and JS
├── style.css               // Global styling for your experiment
├── main.js                 // Entry point to initialize modules and start the experiment
├── config.js               // Global configuration (API keys, WebSocket URL, etc.)
│
├── data/                   // Data files for conditions (e.g., goodAI.json, badAI.json)
│
├── modules/                // Frontend JavaScript modules
│   ├── preTask.js          // Pre-task logic: survey, waiting room, routing
│   ├── trialPhase.js       // Trial logic (to be implemented later)
│   ├── postTask.js         // Post-task logic (survey, data download)
│   ├── chat.js             // Chat functionality integrated with WebSocket
│   ├── utilities.js        // Helper functions (data saving, wallet updates)
│   └── session.js          // Session management (start/end session)
│
├── backend/                // Backend code for WebSocket server
│   └── server.js           // Node.js WebSocket server implementation
│
└── README.md               // Documentation for deploying the experiment on Pavlovia

