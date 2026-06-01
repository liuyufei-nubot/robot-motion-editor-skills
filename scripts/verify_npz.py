#!/usr/bin/env python3
"""Verify Robot Motion Editor NPZ exports."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("npz", type=Path)
    parser.add_argument("--frames", type=int)
    parser.add_argument("--joints", type=int)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--quat-atol", type=float, default=1e-9)
    parser.add_argument("--allow-quat-sign-flips", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data = np.load(args.npz, allow_pickle=True)

    required = ["base_pos_w", "base_quat_w", "joint_pos", "joint_names", "framerate"]
    missing = [key for key in required if key not in data.files]
    if missing:
        raise SystemExit(f"missing keys: {missing}")

    base_pos = data["base_pos_w"]
    base_quat = data["base_quat_w"]
    joint_pos = data["joint_pos"]
    joint_names = data["joint_names"]

    if base_pos.ndim != 2 or base_pos.shape[1] != 3:
        raise SystemExit(f"base_pos_w shape must be (frames, 3), got {base_pos.shape}")
    if base_quat.ndim != 2 or base_quat.shape[1] != 4:
        raise SystemExit(f"base_quat_w shape must be (frames, 4), got {base_quat.shape}")
    if joint_pos.ndim != 2:
        raise SystemExit(f"joint_pos must be 2D, got {joint_pos.shape}")
    if joint_names.ndim != 1:
        raise SystemExit(f"joint_names must be 1D, got {joint_names.shape}")

    frames = base_pos.shape[0]
    joints = joint_pos.shape[1]
    if base_quat.shape[0] != frames or joint_pos.shape[0] != frames:
        raise SystemExit(
            "frame count mismatch: "
            f"base_pos={base_pos.shape}, base_quat={base_quat.shape}, joint_pos={joint_pos.shape}"
        )
    if joint_names.shape[0] != joints:
        raise SystemExit(f"joint_names length {joint_names.shape[0]} != joint_pos joints {joints}")

    if args.frames is not None and frames != args.frames:
        raise SystemExit(f"expected {args.frames} frames, got {frames}")
    if args.joints is not None and joints != args.joints:
        raise SystemExit(f"expected {args.joints} joints, got {joints}")

    fps = float(data["framerate"])
    if abs(fps - args.fps) > 1e-9:
        raise SystemExit(f"expected fps {args.fps}, got {fps}")

    norms = np.linalg.norm(base_quat, axis=1)
    if not np.allclose(norms, 1.0, atol=args.quat_atol):
        raise SystemExit(f"quaternion norm range invalid: {norms.min()}..{norms.max()}")

    dots = np.sum(base_quat[:-1] * base_quat[1:], axis=1)
    negative_count = int((dots < 0).sum())
    if negative_count and not args.allow_quat_sign_flips:
        raise SystemExit(
            f"found {negative_count} adjacent quaternion sign flips; "
            "make signs continuous or pass --allow-quat-sign-flips"
        )

    print(f"verified_npz {args.npz}")
    print(f"size {args.npz.stat().st_size}")
    print(f"keys {sorted(data.files)}")
    print(f"framerate {fps}")
    print(f"shapes base_pos_w={base_pos.shape} base_quat_w={base_quat.shape} joint_pos={joint_pos.shape} joint_names={joint_names.shape}")
    print(f"quat_norm_range {float(norms.min())} {float(norms.max())}")
    print(f"quat_neighbor_dot_min_raw {float(dots.min()) if len(dots) else 1.0} negative_count {negative_count}")
    print(f"base_z_range {float(base_pos[:, 2].min())} {float(base_pos[:, 2].max())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
