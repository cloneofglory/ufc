# UFC Prediction Task Platform
A web-based platform for solo and group UFC fight prediction experiments.

## Features
- Randomized trial order per session, preserving original order for export
- Solo & group sessions with AI rationales (`goodAI`, `badAI`, `neutralAI`)
- Real-time phases & chat via WebSocket
- Pre- and post-task surveys
- One-click CSV export of all solo or group data

## Quick Start
1. **Install**
   ```bash
   git clone <https://github.com/Papyson/ufc_prediction_task.git>
   cd ufc-prediction-platform
   npm install
   ```
2. **Configure** Firestore credentials in `firebaseConfig.js` or via environment variables.
3. **Run**
   ```bash
   nodemon Backend/server.js
   ```
4. **Access**
   - Participant UI: `http://api.mental-model-task.xyz`
   - Researcher downloads: `http://api.mental-model-task.xyz/downloads.html`
   - Solo CSV: `http://api.mental-model-task.xyz/exportCsv?mode=solo`
   - Group CSV: `http://api.mental-model-task.xyz/exportCsv?mode=group`

## Project Structure
```
Backend/       # server.js, session logic, routes
  routes/
    exportCsv.js
  shuffleHelper.js
Assets/        # static assets
data/          # trial CSVs by AI mode
downloads.html # download page
index.html     # experiment loader
modules/       # front-end scripts
```

## Data Export Logic
- Stores `trialOrder` in Firestore for each session
- `exportCsv` endpoint inverts `trialOrder` to output CSV in original sequence

## Contributing
Fork, branch, PR.

---
MIT License



