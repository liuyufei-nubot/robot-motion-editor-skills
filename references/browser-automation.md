# Browser Automation Reference

## Editor API

Recent versions of the editor expose `window.motionEditorAutomation`:

- `getState()`
- `setFrame(frame)`
- `setChannel(type, index, name)`
- `getChannelValue(frame, type, index)`
- `setChannelValue(frame, type, index, value)`
- `setBaseZ(frame, value)`
- `setBaseRoll(frame, value)`
- `getWorldPoint(linkName, localPoint)`
- `getWorldBox(linkName)`
- `getOwnWorldBox(linkName)`
- `setCamera(position, target)`
- `refresh()`

Channel types:

- Base position: `type='pos'`, indices `0=x`, `1=y`, `2=z`.
- Base rotation: `type='rot'`, indices `0=roll`, `1=pitch`, `2=yaw`.
- Joint position: `type='joint'`, index from `motionData.joint_names`.

Base rotation is edited through XYZ Euler angles in the browser. NPZ export stores `base_quat_w` as `[w, x, y, z]`.

## WebDriver Execution Pattern

When a browser is already controlled by WebDriver, execute JavaScript through the existing session:

```js
const sess = '<webdriver-session-id>';
const base = `http://127.0.0.1:4444/session/${sess}`;

async function wd(script) {
  const r = await fetch(`${base}/execute/sync`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({script, args: []})
  });
  const j = await r.json();
  if (j.error) throw new Error(j.message || j.error);
  return j.value;
}
```

Use GET for WebDriver screenshots:

```js
const r = await fetch(`${base}/screenshot`);
const {value: b64} = await r.json();
```

## Browser Backup

Before risky edits:

```js
const A = window.motionEditorAutomation;
window.__motionEditBackup = JSON.parse(JSON.stringify(A.getState().motionData));
```

Restore if needed:

```js
const A = window.motionEditorAutomation;
const m = A.getState().motionData;
const restore = JSON.parse(JSON.stringify(window.__motionEditBackup));
for (const k of Object.keys(restore)) m[k] = restore[k];
A.refresh();
```

## Contact Metrics Snippet

Adapt link names to the loaded robot. For Pi Plus, useful links include:

```js
const links = [
  'base_link', 'torso_link',
  'l_wrist_link', 'r_wrist_link',
  'l_ankle_roll_link', 'r_ankle_roll_link',
  'l_upper_arm_link', 'r_upper_arm_link',
  'l_hip_roll_link', 'r_hip_roll_link',
  'l_thigh_link', 'r_thigh_link',
  'l_calf_link', 'r_calf_link'
];
```

Frame metric:

```js
function frameMetric(f) {
  const A = window.motionEditorAutomation;
  A.setFrame(f);
  let min = Infinity, minLink = null;
  const mins = {};
  for (const link of links) {
    const box = A.getOwnWorldBox(link);
    if (!box) continue;
    const z = box.min[2];
    mins[link] = z;
    if (z < min) { min = z; minLink = link; }
  }
  return {
    f, min, minLink,
    z: A.getChannelValue(f, 'pos', 2),
    rot: [
      A.getChannelValue(f, 'rot', 0),
      A.getChannelValue(f, 'rot', 1),
      A.getChannelValue(f, 'rot', 2)
    ],
    rwRel: (mins.r_wrist_link ?? null) - min,
    lwRel: (mins.l_wrist_link ?? null) - min,
    raRel: (mins.r_ankle_roll_link ?? null) - min,
    laRel: (mins.l_ankle_roll_link ?? null) - min,
    torsoRel: (mins.torso_link ?? null) - min
  };
}
```

## Support Candidate Summary

For prone get-up or hand/foot support edits, compare candidates with counters before keeping a curve:

```js
function supportSummary(start, end) {
  let worstMin = Infinity;
  let headLowest = 0;
  let leftContact = 0;
  let rightContact = 0;
  let leftNear = 0;
  let rightNear = 0;
  let bothHands = 0;
  let handFoot = 0;
  let maxRootJump = 0;
  let maxRootJumpAt = start;

  for (let f = start; f <= end; f++) {
    const m = frameMetric(f);
    worstMin = Math.min(worstMin, m.min);
    if (m.minLink === 'head_pitch_link') headLowest++;
    if (m.lwRel <= 0.018) leftContact++;
    if (m.rwRel <= 0.018) rightContact++;
    if (m.lwRel <= 0.060) leftNear++;
    if (m.rwRel <= 0.060) rightNear++;
    if (m.lwRel <= 0.025 && m.rwRel <= 0.060) bothHands++;
    if (Math.min(m.lwRel, m.rwRel) <= 0.025 &&
        Math.min(m.laRel, m.raRel) <= 0.018) handFoot++;

    if (f > start) {
      const r0 = window.motionEditorAutomation.getChannelValue(f - 1, 'rot', 0);
      const p0 = window.motionEditorAutomation.getChannelValue(f - 1, 'rot', 1);
      const y0 = window.motionEditorAutomation.getChannelValue(f - 1, 'rot', 2);
      const jump =
        Math.abs(m.rot[0] - r0) +
        Math.abs(m.rot[1] - p0) +
        Math.abs(m.rot[2] - y0);
      if (jump > maxRootJump) {
        maxRootJump = jump;
        maxRootJumpAt = f;
      }
    }
  }

  return {
    worstMin, headLowest,
    leftContact, rightContact, leftNear, rightNear,
    bothHands, handFoot,
    maxRootJump, maxRootJumpAt
  };
}
```

Use these counts as decision aids, not absolute goals. Reject a candidate that gains wrist contact by making the head the lowest link or by creating a large root spike.

## Re-floor Edited Frames

After root rotations or smoothing:

```js
for (let f = start; f <= end; f++) {
  const m = frameMetric(f);
  const target = 0.004;
  const oldZ = window.motionEditorAutomation.getChannelValue(f, 'pos', 2);
  window.motionEditorAutomation.setChannelValue(f, 'pos', 2, oldZ + (target - m.min));
}
```

Re-run metrics after this. A rotation edit can change which link is lowest.

For repeated inspection or re-flooring, prefer the bundled helper instead of rewriting a long WebDriver script:

```bash
node skills/robot-motion-editor/scripts/browser_motion_tools.js metrics \
  --session <webdriver-session-id> --start 36 --end 46

node skills/robot-motion-editor/scripts/browser_motion_tools.js refloor \
  --session <webdriver-session-id> --start 20 --end 56 --target 0.004
```

Use the helper output to compare support distribution (`leftContact`, `rightContact`, `bothAssist`, `handFoot`, `lowest`) before accepting a candidate.

## Export Current Browser Motion

```js
const fs = require('fs');
const motion = await wd(`return window.motionEditorAutomation.getState().motionData;`);
const res = await fetch('http://127.0.0.1:45000/api/save_motion', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(motion)
});
if (!res.ok) throw new Error(await res.text());
fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
```

After export, run `scripts/verify_npz.py` for NPZ files.
