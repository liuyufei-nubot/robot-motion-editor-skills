# Tuning Playbook

## Mental Model

Treat motion cleanup as contact-aware pose editing, not curve beautification. A visually smooth curve can still be physically wrong if the robot floats, penetrates the floor, or pivots the body on one unsupported limb.

Always keep three views of the problem active:

- **Geometry:** Which link is lowest? Which links are touching, floating, or penetrating?
- **Support:** Does the support pattern make sense for the body pose and center of mass?
- **Continuity:** Did the adjustment introduce root, limb, or contact jitter?

## Typical Order of Operations

1. Fix gross floor height with Base Z.
2. Fix lying or rolling body contact with Base Roll/Pitch/Yaw.
3. Re-floor every edited frame after changing root orientation.
4. Add or improve support contacts with local limb joints.
5. Coordinate root and adjacent limbs when local IK cannot reach naturally.
6. Smooth short ranges only after contact and support are acceptable.
7. Re-check floor contact, root jumps, and screenshots before export.

## Diagnosing Contacts

Use link bounding boxes rather than eyeballing alone. For each frame, track:

- `min`: lowest geometry Z among relevant links.
- `minLink`: link that determines the floor height.
- `rwRel/lwRel`: wrist link min Z relative to `min`.
- `raRel/laRel`: ankle roll link min Z relative to `min`.
- `torsoRel`: torso min Z relative to `min`.

Working thresholds:

- Floor clearance target: `minZ ~= 0.004 m`.
- Contact candidate: relative height `<= 0.015 m`.
- Floating support limb: visible support pose but relative height clearly above threshold.
- Penetration: any geometry below the floor target after intended re-flooring.

These thresholds are inspection aids, not physics guarantees. Trust the visual scene when boxes include bulky meshes or link origins are misleading.

## Ground Penetration

Start with Base Z if the whole pose is below the floor. If Base Z alone removes penetration but creates an impossible hover or single-point support, adjust Base Roll/Pitch/Yaw and re-floor.

Common pattern:

- Robot is prone/supine and many parts penetrate.
- Raise Base Z to make the lowest link just touch.
- Adjust Base Roll or Pitch so torso/arms/legs lie naturally.
- Recompute min Z and correct Base Z again.

Do not solve repeated penetration by permanently lifting the robot far above the floor. That creates training data with missing contacts.

## Mesh-Based Re-Flooring

When the robot visually floats, do not guess a Base Z offset from the curve alone. Measure the actual lowest visual geometry with `getOwnWorldBox`/`getWorldBox`, then move Base Z so the lowest mesh is near the floor target.

Reliable pattern:

1. Measure `min` and `minLink` for every suspicious frame.
2. Set `Base Z += targetFloor - min`, usually with `targetFloor = 0.004`.
3. Re-run the same metrics after the edit.
4. Inspect key frames from a low camera angle.

Lessons from Pi Plus face-up get-up tuning:

- A monotonic Base Z curve can look smooth while the robot floats several centimeters above the floor. Contact wins over curve monotonicity.
- A non-monotonic Base Z section can be acceptable when the lowest support transfers from wrist to ankle or from one side to the other.
- After root pitch/yaw/roll edits, always re-floor before judging whether a wrist or ankle actually reached the ground.
- If a re-floor pass creates a visible Z pop, smooth only the local root channels or candidate envelope, then re-floor again.
- Keep the re-floor range slightly wider than the visible problem range so endpoints blend, for example edit `34-48` and re-floor `32-50`.

## Single-Limb Support Looks Wrong

If a frame shows one arm or one wrist apparently lifting the full body:

- Check whether the opposite hand or a foot should also be near the floor.
- Prefer distributing support by adjusting root roll/pitch/yaw and the second support limb.
- Avoid forcing one shoulder/elbow into extreme angles just to touch the ground.
- Inspect the body lean relative to support contacts. A small root rotation can make the support pattern much more plausible.

For get-up motions, the plausible progression is often: torso/side contact -> one hand assists -> second hand or foot joins -> feet take over.

For face-up get-up motions with backward arm support, avoid a long window where only one wrist is the lowest link. A better support pattern is often: both wrists near or touching behind the body -> one foot or ankle joins -> wrists release as feet take over.

Useful counters for judging this case:

- `leftContact/rightContact`: wrist relative height `<= 0.018 m`.
- `bothAssist`: both wrists relative height `<= 0.040 m`.
- `handFoot`: at least one wrist near contact and at least one ankle/foot near contact.
- `lowest`: distribution of lowest links across the range.
- `avgLwRel/avgRwRel` and `maxLwRel/maxRwRel`: whether one hand is consistently floating.
- `zJump/rootJump`: whether the cure introduced a new motion spike.

Do not simply maximize one side's contact count. If a candidate changes the lowest link from all right wrist to all left wrist, it may still be a single-arm artifact. Prefer a balanced support distribution unless the source motion clearly intends otherwise.

## Prone Get-Up Hand/Foot Support

For facedown get-up motions, do not require both wrists to be exact lowest links through the whole push. A plausible pattern can be:

- one wrist or forearm carries the main push,
- the other wrist approaches or touches briefly as an assist,
- at least one ankle/foot stays close enough to share support,
- head and torso do not become accidental pivots.

Useful support counters over the edited range:

- `leftContact/rightContact`: wrist relative height `<= 0.018 m`.
- `rightNear/leftNear`: assist wrist relative height `<= 0.060 m`.
- `bothHands`: primary wrist in contact and assist wrist near ground.
- `handFoot`: a wrist contact plus at least one ankle/foot contact.
- `headLowest`: frames where the head link is the lowest geometry.

Prefer the candidate with a believable support pattern, not the one that simply maximizes wrist-contact counts. If making an assist wrist touch causes `headLowest` frames, torso collapse, or stiff shoulder limits, keep it as a near-ground assist instead of forcing exact contact.

## When Local IK Cannot Reach

If wrist or ankle contact cannot be reached with local joints within limits:

- Move the root first: Base Roll/Pitch/Yaw and sometimes Base X/Y.
- Then adjust the limb chain: shoulder pitch/roll, upper arm, elbow, or hip/thigh/calf/ankle.
- Keep changes gradual across a frame window, with endpoints anchored to existing motion.
- Read URDF limits before pushing a joint. Some robots have asymmetric shoulder/ankle limits.

Example lesson from Pi Plus tuning: if a shoulder roll is at or beyond its URDF limit, do not keep pushing that joint. Use root rotation and neighboring joints to bring the wrist to the floor.

Arm joint changes can be counterintuitive after retargeting. A larger shoulder or upper-arm delta may raise the wrist or make the pose rigid. Test small signed deltas on representative frames before accepting a curve edit.

For Pi Plus facedown recovery, root coordination is often more powerful than local arm IK:

- Positive Base Roll can bring the near wrist down into support.
- Base Yaw can trade support between left and right wrists.
- Base Pitch is useful for keeping the head from becoming the lowest support after roll/yaw changes.
- Shoulder/upper-arm/elbow edits should be small smooth assists, not the main mechanism if the root is misaligned.

After a root change, always re-floor before judging whether the wrist or ankle actually gained contact.

For Pi Plus face-up recovery, local arm IK alone may not bring the assist wrist to the floor. Small Base Pitch/Yaw changes can rotate the trunk so both hands become plausible rear supports. Then use shoulder roll or upper-arm/elbow only as small assists. In one useful pattern, Base Pitch provided most of the left-wrist drop, Base Yaw traded load between wrists, and a small left shoulder-roll change made the visual pose less one-sided.

## Candidate Testing Before Committing

Use temporary browser-side backups to compare candidate edits before keeping one:

1. Save the current accepted state.
2. Apply one smooth candidate envelope over the target range.
3. Re-floor the edited frames.
4. Record support counters, worst floor clearance, head-lowest frames, and max root jump.
5. Restore the backup before trying the next candidate.

Reject candidates that improve one metric while breaking another physical invariant. For example, a right-wrist assist that slightly lowers `rwRel` but introduces head-ground contact is usually worse than leaving the right wrist near the floor.

Candidate sweeps in the browser can become slow because every metric call updates meshes. Test in stages:

1. Single-channel sensitivity on representative frames or a short range.
2. A small set of combined candidates using the best directions.
3. Visual review of the top candidate before export.

If a long browser-side candidate test is interrupted, do not keep editing the uncertain current state. Restore the browser backup or reload the NPZ from disk, then apply only the accepted candidate.

## Foot or Leg Oscillation

If a foot plants, lifts, and plants again during standing:

- Check root pitch/roll/yaw first; leg lift can be caused by body rotation, not just ankle joints.
- Inspect ankle roll, ankle pitch, calf, thigh, and hip roll in the oscillating window.
- Smooth the root and leg channels locally, then re-floor.
- Preserve the intended support foot. Do not smooth it into floating.

For post-get-up stabilization, keep foot contacts steady while allowing torso height and pitch to rise smoothly.

## Smoothing Strategy

Do not smooth the whole motion blindly. It can erase contacts and introduce penetration.

Recommended pattern:

1. Choose a narrow frame window around the visible jitter.
2. Smooth only involved channels: root roll/pitch/yaw/z and the limb joints causing the artifact.
3. Use mild low-pass or short-window averaging with fixed endpoints.
4. Re-floor every frame in the edited window.
5. Re-check contact frames and screenshots.

Smoothing root yaw may improve continuity but changes geometry height and support contacts. After yaw smoothing, run floor and contact checks again.

If a support edit exposes a short root kink, smooth only the local root channels around the kink with endpoints preserved. Then re-floor and re-count support contacts. A small reduction in wrist-contact frames may be acceptable if it removes an obvious root spike and the hand/foot support window remains believable.

## Euler Yaw Wrap

The editor displays base rotation as XYZ Euler angles, but exports base orientation as quaternion `[w, x, y, z]`. A vertical line in the Base Yaw curve near `+pi/-pi` can be display wrap, not a real rotation jump.

Before changing yaw only because of a plotted spike:

- Compare neighboring quaternion dot products.
- If adjacent quaternion dot products are positive and near 1, the orientation is continuous.
- If smoothing yaw, unwrap angles, smooth locally, wrap back only for storage/display, then verify quaternion continuity after export.

## Visual Review

Use screenshots or direct browser inspection for:

- Start of edited range.
- First contact frame.
- Strongest support frame.
- Contact release frame.
- Standing or recovery stabilization frames.
- Any frame with a numeric anomaly.

Use at least one alternate camera angle for contact problems. A wrist can look grounded from one angle while floating from another.

## Naming Preview Files

Use descriptive preview suffixes:

- `baseZ_roll_preview1`
- `baseZ_roll_pitch_root_preview3`
- `rightarm_preview5`
- `rightarm_smooth_preview6`

Never overwrite the user's original source file. Keep the last accepted preview intact before experimenting.
