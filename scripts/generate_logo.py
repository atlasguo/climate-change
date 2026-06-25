#!/usr/bin/env python3
"""Generate a high-resolution Climate Change Visualized logo from global monthly data."""

from __future__ import annotations

import argparse
import json
import math
from collections import OrderedDict
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def interpolate_hex(left: str, right: str, mix: float) -> tuple[int, int, int]:
    def parse(color: str) -> tuple[int, int, int]:
        color = color.removeprefix("#")
        return tuple(int(color[index : index + 2], 16) for index in range(0, 6, 2))

    left_rgb = parse(left)
    right_rgb = parse(right)
    return tuple(
        round(start + (end - start) * mix)
        for start, end in zip(left_rgb, right_rgb)
    )


def emphasize_midrange(normalized: float, exponent: float = 0.62) -> float:
    if normalized <= 0 or normalized >= 1:
        return normalized
    if normalized < 0.5:
        return 0.5 * ((normalized / 0.5) ** exponent)
    return 1 - 0.5 * (((1 - normalized) / 0.5) ** exponent)


def ramp_color(value: float, domain: tuple[float, float], palette: Sequence[str]) -> tuple[int, int, int]:
    start, end = domain
    normalized = clamp((value - start) / ((end - start) or 1), 0, 1)
    emphasized = emphasize_midrange(normalized)
    scaled = emphasized * (len(palette) - 1)
    left_index = int(math.floor(scaled))
    right_index = min(len(palette) - 1, left_index + 1)
    return interpolate_hex(palette[left_index], palette[right_index], scaled - left_index)


def polar_to_cartesian(cx: float, cy: float, radius: float, angle: float) -> tuple[float, float]:
    return (cx + radius * math.cos(angle), cy + radius * math.sin(angle))


def ring_slice_points(
    cx: float,
    cy: float,
    inner_radius: float,
    outer_radius: float,
    start_angle: float,
    end_angle: float,
    steps: int = 18,
) -> list[tuple[float, float]]:
    outer_points = [
        polar_to_cartesian(cx, cy, outer_radius, start_angle + (end_angle - start_angle) * (index / steps))
        for index in range(steps + 1)
    ]
    inner_points = [
        polar_to_cartesian(cx, cy, inner_radius, end_angle - (end_angle - start_angle) * (index / steps))
        for index in range(steps + 1)
    ]
    return outer_points + inner_points


def load_palette_config(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def apply_rounded_corners(image: Image.Image, radius_ratio: float) -> Image.Image:
    radius_ratio = max(0.0, min(0.5, radius_ratio))
    if radius_ratio <= 0:
        return image

    rounded = image.copy()
    mask = Image.new("L", rounded.size, 0)
    draw = ImageDraw.Draw(mask)
    radius = max(1, round(min(rounded.size) * radius_ratio))
    draw.rounded_rectangle((0, 0, rounded.width - 1, rounded.height - 1), radius=radius, fill=255)
    rounded.putalpha(mask)
    return rounded


def load_global_monthly_temperature_series(metadata_path: Path, cells_path: Path) -> tuple[list[str], list[float]]:
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    cells_payload = json.loads(cells_path.read_text(encoding="utf-8"))
    cells = cells_payload["cells"]
    month_labels = metadata["monthLabels"]
    sums = [0.0] * len(month_labels)
    weights = [0.0] * len(month_labels)

    for cell in cells:
      weight = max(0.0001, math.cos(math.radians(cell["lat"])))
      for index, value in enumerate(cell["tempSeries"]):
          if value is None:
              continue
          sums[index] += float(value) * weight
          weights[index] += weight

    return month_labels, [month_sum / weight if weight else 0.0 for month_sum, weight in zip(sums, weights)]


def split_series_by_year(month_labels: Sequence[str], monthly_series: Sequence[float]) -> OrderedDict[int, list[float]]:
    years: OrderedDict[int, list[float]] = OrderedDict()
    for label, value in zip(month_labels, monthly_series):
        year = int(str(label).split("-")[0])
        years.setdefault(year, []).append(float(value))
    return years


def resample_yearly_series(yearly_series: OrderedDict[int, list[float]], target_count: int | None) -> OrderedDict[int, list[float]]:
    if target_count is None or target_count <= 0 or len(yearly_series) <= target_count:
        return yearly_series

    entries = list(yearly_series.items())
    sampled: OrderedDict[int, list[float]] = OrderedDict()
    stride = (len(entries) - 1) / max(1, target_count - 1)

    for sample_index in range(target_count):
        position = sample_index * stride
        entry_index = int(round(position))
        year, months = entries[min(len(entries) - 1, max(0, entry_index))]
        sampled[year] = months

    return sampled


def draw_logo(
    yearly_series: OrderedDict[int, list[float]],
    output_path: Path,
    size: int,
    supersample: int,
    background: str,
    max_rings: int | None,
    palette: Sequence[str],
) -> None:
    yearly_series = resample_yearly_series(yearly_series, max_rings)
    canvas_size = size * supersample
    image = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    cx = cy = canvas_size / 2

    if background == "dark":
        draw.rounded_rectangle(
            (0, 0, canvas_size - 1, canvas_size - 1),
            radius=round(canvas_size * 0.18),
            fill=(8, 16, 24, 255),
        )

    values = [value for months in yearly_series.values() for value in months]
    domain = (min(values), max(values))

    outer_radius = canvas_size * 0.44
    inner_radius = canvas_size * 0.09
    ring_count = max(1, len(yearly_series))
    ring_thickness = (outer_radius - inner_radius) / ring_count
    slice_angle = (math.tau / 12.0)
    slice_overlap = slice_angle * 0.012
    start_offset = -math.pi / 2

    if background == "dark":
        draw.ellipse(
            (
                cx - outer_radius - canvas_size * 0.018,
                cy - outer_radius - canvas_size * 0.018,
                cx + outer_radius + canvas_size * 0.018,
                cy + outer_radius + canvas_size * 0.018,
            ),
            outline=(255, 255, 255, 14),
            width=max(2, round(canvas_size * 0.0014)),
        )

    for ring_index, (_, months) in enumerate(yearly_series.items()):
        ring_inner = inner_radius + ring_index * ring_thickness
        ring_outer = outer_radius if ring_index == ring_count - 1 else ring_inner + ring_thickness
        for month_index, value in enumerate(months[:12]):
            start_angle = start_offset + month_index * slice_angle - slice_overlap
            end_angle = start_offset + (month_index + 1) * slice_angle + slice_overlap
            fill = ramp_color(value, domain, palette)
            points = ring_slice_points(cx, cy, ring_inner, ring_outer, start_angle, end_angle)
            draw.polygon(points, fill=(*fill, 255))

    core_radius = inner_radius - canvas_size * 0.018
    draw.ellipse(
        (cx - core_radius, cy - core_radius, cx + core_radius, cy + core_radius),
        fill=(8, 16, 24, 255 if background == "dark" else 245),
    )

    if supersample > 1:
        image = image.resize((size, size), Image.Resampling.LANCZOS)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--palette-config", type=Path, default=Path("config/visual-palettes.json"))
    parser.add_argument("--metadata", type=Path, default=Path("data/metadata.json"))
    parser.add_argument("--cells", type=Path, default=Path("data/cells-medium.json"))
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/branding/climate-change-visualized-logo.png"),
    )
    parser.add_argument("--size", type=int, default=2048)
    parser.add_argument("--supersample", type=int, default=2)
    parser.add_argument(
        "--background",
        choices=("transparent", "dark"),
        default="transparent",
    )
    parser.add_argument("--max-rings", type=int, default=None)
    parser.add_argument("--resize-from", type=Path, default=None)
    parser.add_argument("--corner-radius-ratio", type=float, default=0.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.resize_from is not None:
        source_image = Image.open(args.resize_from).convert("RGBA")
        resized = source_image.resize((args.size, args.size), Image.Resampling.LANCZOS)
        resized = apply_rounded_corners(resized, args.corner_radius_ratio)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        resized.save(args.output)
        print(f"Saved resized logo to {args.output}")
        return

    palette_config = load_palette_config(args.palette_config)
    temperature_palette = palette_config["temperature"]
    month_labels, monthly_series = load_global_monthly_temperature_series(args.metadata, args.cells)
    yearly_series = split_series_by_year(month_labels, monthly_series)
    draw_logo(yearly_series, args.output, args.size, args.supersample, args.background, args.max_rings, temperature_palette)
    if args.corner_radius_ratio > 0:
        image = Image.open(args.output).convert("RGBA")
        image = apply_rounded_corners(image, args.corner_radius_ratio)
        image.save(args.output)
    print(f"Saved logo to {args.output}")


if __name__ == "__main__":
    main()
