---
name: robot-motion-editor
description: "Use when working in the Robot Motion Editor to tune retargeted robot motion data (.npz/.csv) for physical plausibility: ground contact, penetration, wrist/ankle support, root/base coordination, joint curve smoothing, browser visual inspection, and verified export."
---

# Robot Motion Editor

## Overview

Use this skill to edit robot motion in the browser editor as a visual, iterative tuning process. The goal is not just smooth curves; the motion should look physically plausible, avoid ground penetration, preserve intentional contacts, and export to a verified NPZ/CSV.

## Required References

- Read `references/tuning-playbook.md` before changing motion values. It contains the contact, root coordination, smoothing, and visual review heuristics.
- Read `references/browser-automation.md` when using WebDriver or `window.motionEditorAutomation` to inspect, edit, screenshot, or export.
- Run `scripts/verify_npz.py` after exporting an NPZ.

## Workflow

1. **Confirm context**
   - Identify the robot variant, URDF path, motion file, frame count, joint names, and target problem frames.
   - Do not assume a similar robot is correct. Pi Plus, LSE, and other variants can have different link names, joint names, and limits.
   - If the browser already has the desired file loaded, preserve that state and do not reload unless necessary.

2. **Create a reversible checkpoint**
   - Save a browser-side copy of `motionData` before edits.
   - Export accepted intermediate previews with descriptive names instead of overwriting the last good version.

3. **Diagnose visually and numerically**
   - Scrub the suspicious frame range and inspect several camera angles.
   - Measure floor contact using link bounding boxes, especially wrists, ankle roll links, torso, hips, and upper arms.
   - Record the lowest link, minimum Z, contact links, root roll/pitch/yaw, and base Z at representative frames.
   - For hand/foot support problems, compare temporary candidate edits with support counters before committing a curve.

4. **Edit in layers**
   - Start with base/root pose when the whole body is misplaced: Base Z, Base Roll, Base Pitch, Base Yaw, and sometimes Base X/Y.
   - Then tune contact chains: shoulder/elbow/wrist for hands; hip/thigh/calf/ankle for feet.
   - Use full-body coordination when a limb cannot plausibly reach contact by itself. Move root orientation and nearby limbs together instead of overbending one joint.
   - Respect URDF joint limits. If a joint is already outside or near a limit, prefer root/body coordination or another supporting limb.
   - Do not force an assist hand into exact ground contact if doing so makes the head, torso, or a joint limit become the real support artifact.

5. **Re-floor after rotations**
   - Any root/base rotation can change geometry height. Recompute minimum Z and adjust Base Z after the rotation edit.
   - Keep intentional contacts lightly touching the ground, not buried below it.

6. **Smooth without erasing contacts**
   - Smooth only the local channels and frame ranges that cause visible jitter.
   - Preserve support windows and endpoints. After smoothing, re-check contact links and floor penetration.
   - Beware Euler yaw wrap near `+/-pi`; verify quaternion continuity before treating a plotted vertical line as a true motion jump.

7. **Verify and export**
   - Revisit key frames with screenshots or direct browser inspection.
   - Check numeric invariants: no penetration in the edited range, preserved contact windows, no large root jumps, valid joint/array shapes, normalized and sign-continuous base quaternions.
   - Export a new preview file and run NPZ verification.

## Completion Checklist

- Correct robot and motion file were used.
- The edited range has visual review at key frames and at least one alternate camera angle.
- Floor minimum is at the chosen clearance, typically about `0.004 m`, across the edited range.
- Intentional wrist/ankle contacts are documented by frame range.
- No single limb carries the body in an obviously impossible pose unless the source motion requires it.
- For prone get-up motions, hand/foot support is distributed: primary hand, assisting hand or near-ground wrist, and foot/ankle contacts are all considered.
- Root roll/pitch/yaw and Base Z have no unexplained spikes.
- Exported file was verified with `scripts/verify_npz.py`.
