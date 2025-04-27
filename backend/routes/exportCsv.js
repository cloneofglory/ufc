// Backend/routes/exportCsv.js
const express = require('express');
const router = express.Router();
const { firestore } = require('../firebaseConfig');

// Map our feature keys to the actual Firestore field names
const featureKeyMap = {
  CareerWins:           'wins',
  CareerLosses:         'losses',
  Age:                  'age',
  Height:               'height',
  StrikesLandedPerMin:  'slpm',
  StrikeAccuracy:       'accuracy',
  StrikeDefense:        'defense',
  TakedownDefense:      'tdDefense',
  StrikesAvoidedPerMin: 'sapm',
  TakedownAccuracy:     'tdAccuracy',
};
const featureKeys = Object.keys(featureKeyMap);

// Prefixed header names
const preFields  = featureKeys.map(k => `pretask_${k}`);
const postFields = featureKeys.map(k => `posttask_${k}`);

/**
 * GET /exportCsv?mode=solo|group
 * Streams CSV of all sessions of that mode, in original-trial order.
 */
router.get('/', async (req, res) => {
  const { mode } = req.query;
  if (!mode || !['solo','group'].includes(mode)) {
    return res
      .status(400)
      .send('Error: please request /exportCsv?mode=solo or ?mode=group');
  }

  // 1) Fetch sessions of this mode
  const sessionsSnap = await firestore
    .collection('sessions')
    .where('mode', '==', mode)
    .get();
  const sessions = sessionsSnap.docs.map(doc => ({
    id: doc.id,
    data: doc.data()
  }));

  if (sessions.length === 0) {
    return res
      .status(404)
      .send(`No sessions found for mode=${mode}`);
  }

  // 2) Determine trial count and build header
  const trialCount = sessions[0].data.trialCount || 50;
  let headers = ['sessionID','clientID','aiMode', ...preFields];
  for (let i = 1; i <= trialCount; i++) {
    if (mode === 'solo') {
      headers.push(
        `trial${i}_initialWager`,
        `trial${i}_finalWager`,
        `wallet_after_trial${i}`
      );
    } else {
      headers.push(
        `trial${i}_initialWager`,
        `trial${i}_finalWager`,
        `trial${i}_groupAvgWager`,
        `trial${i}_changedDirection`,
        `wallet_after_trial${i}`
      );
    }
  }
  headers = headers.concat(postFields);

  // 3) Stream CSV header
  res.setHeader('Content-Type','text/csv');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${mode}_sessions_export.csv"`
  );
  res.write(headers.join(',') + '\n');

  // 4) For each session & participant, build a row
  for (const { id: sid, data: sData } of sessions) {
    const participants = sData.participants || [];
    // Pre‑compute trialOrder mapping:
    const order = Array.isArray(sData.trialOrder) && sData.trialOrder.length === trialCount
      ? sData.trialOrder
      : Array.from({length: trialCount}, (_, i) => i);
    // presentationSlots[j] gives the 1-based trialNumber where original row j appeared
    const presentationSlots = order.map(idx => idx + 1);

    for (const pid of participants) {
      const row = {
        sessionID: sid,
        clientID: pid,
        aiMode:    sData.aiMode || ''
      };

      // -- Pre-task survey --
      const preSnap = await firestore
        .collection('sessions').doc(sid)
        .collection('participantData')
        .doc(`${pid}_preTask`)
        .get();
      const pre = preSnap.exists ? preSnap.data() : {};
      featureKeys.forEach(key => {
        const dbFld = featureKeyMap[key];
        row[`pretask_${key}`] = pre[`pretask_${key}`] ?? pre[dbFld] ?? '';
      });

      // -- Trials --
      if (mode === 'solo') {
        // one doc per trial filtered by clientID
        const snap = await firestore
          .collection('sessions').doc(sid)
          .collection('trials')
          .where('clientID','==',pid)
          .get();
        const tmap = {};
        snap.forEach(d => {
          const doc = d.data();
          tmap[doc.trialNumber] = doc;
        });

        // Loop in ORIGINAL order: j=0..trialCount-1
        for (let j = 0; j < trialCount; j++) {
          const slot = presentationSlots[j];
          const t = tmap[slot] || {};
          row[`trial${j+1}_initialWager`] = t.initialWager ?? '';
          row[`trial${j+1}_finalWager`]   = t.finalWager   ?? '';
          row[`wallet_after_trial${j+1}`] = t.walletAfter  ?? '';
        }

      } else {
        // group: shared docs with .submissions map
        const snap = await firestore
          .collection('sessions').doc(sid)
          .collection('trials')
          .get();
        const subsByTrial = {};
        snap.forEach(d => {
          const doc = d.data();
          subsByTrial[doc.trialNumber] = doc.submissions || {};
        });

        for (let j = 0; j < trialCount; j++) {
          const slot = presentationSlots[j];
          const subs = subsByTrial[slot] || {};
          const me   = subs[pid] || {};
          const init = me.initialWager ?? '';
          const fin  = me.finalWager   ?? '';
          const vals = Object.values(subs).map(s => s.finalWager || 0);
          const avg  = vals.length
            ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2)
            : '';
          const changed = avg !== ''
            ? (Math.abs(fin-avg) < Math.abs(init-avg))
            : '';
          row[`trial${j+1}_initialWager`]     = init;
          row[`trial${j+1}_finalWager`]       = fin;
          row[`trial${j+1}_groupAvgWager`]    = avg;
          row[`trial${j+1}_changedDirection`] = changed;
          row[`wallet_after_trial${j+1}`]     = me.walletAfter ?? '';
        }
      }

      // -- Post-task survey --
      const postSnap = await firestore
        .collection('sessions').doc(sid)
        .collection('participantData')
        .doc(`${pid}_postTask`)
        .get();
      const post = postSnap.exists ? postSnap.data() : {};
      featureKeys.forEach(key => {
        const dbFld = featureKeyMap[key];
        row[`posttask_${key}`] = post[`posttask_${key}`] ?? post[dbFld] ?? '';
      });

      // 5) Write CSV row
      const line = headers.map(h => {
        const cell = String(row[h] ?? '').replace(/"/g,'""');
        return `"${cell}"`;
      }).join(',');
      res.write(line + '\n');
    }
  }

  res.end();
});

module.exports = router;
