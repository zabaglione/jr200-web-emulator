#!/usr/bin/env python3
# SPDX-License-Identifier: BSD-3-Clause
"""Compare generated cassette PCM with an independent reference waveform."""

from __future__ import annotations

import argparse
import statistics
import struct
import wave
from dataclasses import dataclass
from pathlib import Path


SIGNAL_RATE = 4_800
LEADER_SAMPLES = 136 * 8 * 8
FIRST_GAP_SAMPLES = 12 * 8 * 8
INTER_BLOCK_SAMPLES = 36 * 8 * 8


@dataclass(frozen=True)
class Run:
    sign: int
    start: int
    end: int
    category: str

    @property
    def length(self) -> int:
        return self.end - self.start


def read_pcm(path: Path) -> tuple[int, tuple[int, ...]]:
    with wave.open(str(path), "rb") as stream:
        if stream.getnchannels() != 1 or stream.getsampwidth() != 2:
            raise ValueError(f"{path}: expected mono 16-bit PCM")
        rate = stream.getframerate()
        frames = stream.getnframes()
        samples = struct.unpack(f"<{frames}h", stream.readframes(frames))
    return rate, samples


def sign_runs(samples: tuple[int, ...], rate: int) -> list[Run]:
    if not samples:
        raise ValueError("empty PCM stream")
    first_nonzero = next((sample for sample in samples if sample != 0), None)
    if first_nonzero is None:
        raise ValueError("PCM stream is silent")
    previous = 1 if first_nonzero > 0 else -1
    signs: list[int] = []
    for sample in samples:
        if sample > 0:
            previous = 1
        elif sample < 0:
            previous = -1
        signs.append(previous)

    boundaries = [0]
    for index in range(1, len(signs)):
        if signs[index] != signs[index - 1]:
            boundaries.append(index)
    boundaries.append(len(signs))

    threshold = rate / 3_200
    outlier = rate / 100
    runs: list[Run] = []
    for start, end in zip(boundaries, boundaries[1:]):
        length = end - start
        category = "X" if length >= outlier else "L" if length > threshold else "S"
        runs.append(Run(signs[start], start, end, category))
    return runs


def cjr_blocks(data: bytes) -> list[bytes]:
    blocks: list[bytes] = []
    offset = 0
    while offset < len(data):
        if len(data) - offset < 4:
            raise ValueError(f"truncated CJR block at byte {offset}")
        length = 6 if data[offset + 2] == 0xFF else (data[offset + 3] or 256) + 7
        if length > len(data) - offset:
            raise ValueError(f"truncated CJR block at byte {offset}")
        blocks.append(data[offset : offset + length])
        offset += length
    if len(blocks) < 2:
        raise ValueError("expected header and data/footer CJR blocks")
    return blocks


def pcm_boundary(signal_sample: int, rate: int) -> int:
    return (signal_sample * rate + SIGNAL_RATE - 1) // SIGNAL_RATE


def block_cores(
    runs: list[Run], rate: int, blocks: list[bytes], data_baud: int
) -> list[tuple[str, int]]:
    signal_start = LEADER_SAMPLES + FIRST_GAP_SAMPLES
    cores: list[tuple[str, int]] = []
    for block_index, block in enumerate(blocks):
        samples_per_bit = 8 if block_index == 0 or data_baud == 600 else 2
        signal_end = signal_start + len(block) * 12 * samples_per_bit
        pcm_start = pcm_boundary(signal_start, rate)
        pcm_end = pcm_boundary(signal_end, rate)

        indices = [
            index
            for index, run in enumerate(runs)
            if run.end > pcm_start and run.start < pcm_end
        ]
        if len(indices) < 10:
            raise ValueError(f"block {block_index} has too few waveform transitions")
        first = indices[0] + 4
        last = indices[-1] - 3
        core = "".join(run.category for run in runs[first:last])
        if "X" in core:
            raise ValueError(f"block {block_index} contains an unexpected long span")
        cores.append((core, runs[first].sign))
        signal_start = signal_end + INTER_BLOCK_SAMPLES
    return cores


def locate_core(runs: list[Run], core: str, sign: int, begin: int) -> int:
    categories = "".join(run.category for run in runs)
    candidate = categories.find(core, begin)
    while candidate >= 0:
        if runs[candidate].sign == sign:
            return candidate
        candidate = categories.find(core, candidate + 1)
    raise ValueError("reference waveform does not contain a block phase pattern")


def mean_half_spans(runs: list[Run]) -> tuple[float, float]:
    short = [run.length for run in runs if run.category == "S"]
    long = [run.length for run in runs if run.category == "L"]
    if not short or not long:
        raise ValueError("waveform does not contain both half-span lengths")
    return statistics.fmean(short), statistics.fmean(long)


def compare(ours_path: Path, reference_path: Path, cjr_path: Path, data_baud: int) -> None:
    ours_rate, ours_pcm = read_pcm(ours_path)
    reference_rate, reference_pcm = read_pcm(reference_path)
    if ours_rate != reference_rate:
        raise ValueError(f"sample-rate mismatch: {ours_rate} != {reference_rate}")
    if ours_rate not in (44_100, 48_000):
        raise ValueError("only the P10 44.1/48 kHz profiles are supported")

    blocks = cjr_blocks(cjr_path.read_bytes())
    ours_runs = sign_runs(ours_pcm, ours_rate)
    reference_runs = sign_runs(reference_pcm, reference_rate)
    cores = block_cores(ours_runs, ours_rate, blocks, data_baud)

    ours_locations: list[int] = []
    reference_locations: list[int] = []
    ours_begin = 0
    reference_begin = 0
    for core, sign in cores:
        ours_location = locate_core(ours_runs, core, sign, ours_begin)
        reference_location = locate_core(reference_runs, core, sign, reference_begin)
        ours_locations.append(ours_location)
        reference_locations.append(reference_location)
        ours_begin = ours_location + len(core)
        reference_begin = reference_location + len(core)

    ours_short, ours_long = mean_half_spans(ours_runs)
    reference_short, reference_long = mean_half_spans(reference_runs)
    expected_short = ours_rate / SIGNAL_RATE
    expected_long = expected_short * 2
    for label, observed, expected in (
        ("ours short", ours_short, expected_short),
        ("ours long", ours_long, expected_long),
        ("reference short", reference_short, expected_short),
        ("reference long", reference_long, expected_long),
    ):
        if abs(observed - expected) > 0.6:
            raise ValueError(f"{label} half-span {observed:.3f} != {expected:.3f}")

    def anchor_ms(runs: list[Run], left: int, right: int) -> float:
        return (runs[right].start - runs[left].start) * 1_000 / ours_rate

    ours_intervals = [
        anchor_ms(ours_runs, ours_locations[index], ours_locations[index + 1])
        for index in range(len(ours_locations) - 1)
    ]
    reference_intervals = [
        anchor_ms(reference_runs, reference_locations[index], reference_locations[index + 1])
        for index in range(len(reference_locations) - 1)
    ]
    phase = "negative" if ours_runs[ours_locations[0]].sign < 0 else "positive"
    ours_prefix = ours_runs[ours_locations[0]].start * 1_000 / ours_rate
    reference_prefix = reference_runs[reference_locations[0]].start * 1_000 / ours_rate
    print(
        f"PASS {ours_rate} Hz / {data_baud} baud: "
        f"{len(blocks)} block phase patterns match ({phase} first anchor)"
    )
    print(
        "  half-spans samples short/long: "
        f"ours={ours_short:.3f}/{ours_long:.3f}, "
        f"reference={reference_short:.3f}/{reference_long:.3f}"
    )
    print(
        "  first-block anchor ms: "
        f"ours={ours_prefix:.3f}, reference={reference_prefix:.3f}"
    )
    print(
        "  block-anchor intervals ms: "
        f"ours={','.join(f'{value:.3f}' for value in ours_intervals)}, "
        f"reference={','.join(f'{value:.3f}' for value in reference_intervals)}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("ours", type=Path)
    parser.add_argument("reference", type=Path)
    parser.add_argument("cjr", type=Path)
    parser.add_argument("--data-baud", type=int, choices=(600, 2400), required=True)
    args = parser.parse_args()
    compare(args.ours, args.reference, args.cjr, args.data_baud)


if __name__ == "__main__":
    main()
