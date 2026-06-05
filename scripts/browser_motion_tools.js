#!/usr/bin/env node

const fs = require('fs');

const DEFAULT_LINKS = [
  'base_link', 'torso_link', 'head_pitch_link', 'head_yaw_link',
  'r_wrist_link', 'l_wrist_link',
  'r_ankle_roll_link', 'l_ankle_roll_link',
  'r_upper_arm_link', 'l_upper_arm_link',
  'r_calf_link', 'l_calf_link',
  'r_thigh_link', 'l_thigh_link'
];

function usage() {
  console.log(`Usage:
  node browser_motion_tools.js metrics --session ID --start N --end N [--frames a,b,c]
  node browser_motion_tools.js refloor --session ID --start N --end N [--target 0.004]
  node browser_motion_tools.js export --session ID --out edited_outputs/file.npz

Options:
  --port N          WebDriver port, default 4444
  --backend URL     Editor backend URL, default http://127.0.0.1:45000
  --links a,b,c     Override measured link names
`);
}

function parseArgs(argv) {
  const args = { port: 4444, backend: 'http://127.0.0.1:45000', target: 0.004 };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[++i];
      if (value == null) throw new Error(`Missing value for ${arg}`);
      args[key] = value;
    } else {
      positional.push(arg);
    }
  }
  args.mode = positional[0];
  if (args.start != null) args.start = Number(args.start);
  if (args.end != null) args.end = Number(args.end);
  if (args.port != null) args.port = Number(args.port);
  if (args.target != null) args.target = Number(args.target);
  if (args.frames) args.frames = String(args.frames).split(',').map(x => Number(x.trim()));
  if (args.links) args.links = String(args.links).split(',').map(x => x.trim()).filter(Boolean);
  return args;
}

async function webdriver(port, session, script, args = []) {
  const url = `http://127.0.0.1:${port}/session/${session}/execute/sync`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, args })
  });
  const json = await response.json();
  if (json.error) throw new Error(json.message || json.error);
  return json.value;
}

function browserMetricsScript() {
  return function run(opts) {
    const A = window.motionEditorAutomation;
    if (!A) throw new Error('window.motionEditorAutomation is not available');
    const state = A.getState();
    if (!state.robotLoaded || !state.motionData) {
      throw new Error('Robot or motion data is not loaded');
    }

    const links = opts.links;
    const start = opts.start;
    const end = opts.end;
    const frames = opts.frames && opts.frames.length
      ? opts.frames
      : Array.from({ length: end - start + 1 }, (_, i) => start + i);

    function frameMetric(f) {
      A.setFrame(f);
      let min = Infinity;
      let minLink = null;
      const mins = {};
      for (const link of links) {
        const box = A.getOwnWorldBox(link) || A.getWorldBox(link);
        if (!box) continue;
        const z = box.min[2];
        mins[link] = z;
        if (z < min) {
          min = z;
          minLink = link;
        }
      }
      function rel(link) {
        return mins[link] == null ? null : mins[link] - min;
      }
      return {
        f,
        min,
        minLink,
        z: A.getChannelValue(f, 'pos', 2),
        rwRel: rel('r_wrist_link'),
        lwRel: rel('l_wrist_link'),
        raRel: rel('r_ankle_roll_link'),
        laRel: rel('l_ankle_roll_link'),
        torsoRel: rel('torso_link'),
        headRel: Math.min(
          rel('head_pitch_link') == null ? Infinity : rel('head_pitch_link'),
          rel('head_yaw_link') == null ? Infinity : rel('head_yaw_link')
        )
      };
    }

    if (opts.mode === 'refloor') {
      for (let f = start; f <= end; f++) {
        const m = frameMetric(f);
        const oldZ = A.getChannelValue(f, 'pos', 2);
        A.setChannelValue(f, 'pos', 2, oldZ + (opts.target - m.min));
      }
      A.refresh();
    }

    const summary = {
      worstMin: Infinity,
      bestMin: -Infinity,
      leftContact: 0,
      rightContact: 0,
      leftNear: 0,
      rightNear: 0,
      bothAssist: 0,
      handFoot: 0,
      headLowest: 0,
      avgLwRel: 0,
      avgRwRel: 0,
      maxLwRel: 0,
      maxRwRel: 0,
      zJump: 0,
      lowest: {}
    };

    let prevZ = null;
    for (let f = start; f <= end; f++) {
      const m = frameMetric(f);
      summary.worstMin = Math.min(summary.worstMin, m.min);
      summary.bestMin = Math.max(summary.bestMin, m.min);
      summary.lowest[m.minLink] = (summary.lowest[m.minLink] || 0) + 1;
      if (m.minLink === 'head_pitch_link' || m.minLink === 'head_yaw_link') {
        summary.headLowest += 1;
      }
      if (m.lwRel != null && m.lwRel <= 0.018) summary.leftContact += 1;
      if (m.rwRel != null && m.rwRel <= 0.018) summary.rightContact += 1;
      if (m.lwRel != null && m.lwRel <= 0.060) summary.leftNear += 1;
      if (m.rwRel != null && m.rwRel <= 0.060) summary.rightNear += 1;
      if (m.lwRel != null && m.rwRel != null && m.lwRel <= 0.040 && m.rwRel <= 0.040) {
        summary.bothAssist += 1;
      }
      const hand = Math.min(
        m.lwRel == null ? Infinity : m.lwRel,
        m.rwRel == null ? Infinity : m.rwRel
      );
      const foot = Math.min(
        m.laRel == null ? Infinity : m.laRel,
        m.raRel == null ? Infinity : m.raRel
      );
      if (hand <= 0.025 && foot <= 0.025) summary.handFoot += 1;
      if (m.lwRel != null) {
        summary.avgLwRel += m.lwRel;
        summary.maxLwRel = Math.max(summary.maxLwRel, m.lwRel);
      }
      if (m.rwRel != null) {
        summary.avgRwRel += m.rwRel;
        summary.maxRwRel = Math.max(summary.maxRwRel, m.rwRel);
      }
      if (prevZ != null) summary.zJump = Math.max(summary.zJump, Math.abs(m.z - prevZ));
      prevZ = m.z;
    }

    const count = end - start + 1;
    summary.avgLwRel /= count;
    summary.avgRwRel /= count;

    const table = frames.map(frameMetric);
    function roundValue(value) {
      return typeof value === 'number' && Number.isFinite(value)
        ? Number(value.toFixed(5))
        : value;
    }
    function roundObject(obj) {
      const out = {};
      for (const [key, value] of Object.entries(obj)) {
        out[key] = roundValue(value);
      }
      return out;
    }

    return {
      mode: opts.mode,
      range: [start, end],
      target: opts.target,
      summary: roundObject(summary),
      table: table.map(roundObject)
    };
  };
}

async function exportMotion(opts) {
  if (!opts.out) throw new Error('--out is required for export');
  const motion = await webdriver(
    opts.port,
    opts.session,
    'return window.motionEditorAutomation.getState().motionData;'
  );
  const response = await fetch(`${opts.backend}/api/save_motion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(motion)
  });
  if (!response.ok) throw new Error(await response.text());
  fs.writeFileSync(opts.out, Buffer.from(await response.arrayBuffer()));
  return { out: opts.out, bytes: fs.statSync(opts.out).size };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help || !opts.mode) {
    usage();
    return;
  }
  if (!opts.session) throw new Error('--session is required');

  if (opts.mode === 'export') {
    console.log(JSON.stringify(await exportMotion(opts), null, 2));
    return;
  }

  if (!Number.isInteger(opts.start) || !Number.isInteger(opts.end)) {
    throw new Error('--start and --end are required integer frame indices');
  }
  if (opts.end < opts.start) throw new Error('--end must be >= --start');

  const links = opts.links || DEFAULT_LINKS;
  const script = `return (${browserMetricsScript().toString()})(arguments[0]);`;
  const result = await webdriver(opts.port, opts.session, script, [{
    mode: opts.mode,
    start: opts.start,
    end: opts.end,
    frames: opts.frames,
    links,
    target: opts.target
  }]);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
