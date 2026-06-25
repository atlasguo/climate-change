from __future__ import annotations

import argparse
import colorsys
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


BACKGROUND = (2, 7, 11, 255)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate favicon option 4 from the loading ring geometry and palette extremes."
    )
    parser.add_argument(
        "--palette-config",
        type=Path,
        default=Path("config/visual-palettes.json"),
        help="Path to the unified palette config JSON.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/favicons/favicon-option4.png"),
        help="Output PNG path.",
    )
    parser.add_argument(
        "--size",
        type=int,
        default=512,
        help="Final square image size in pixels.",
    )
    parser.add_argument(
        "--supersample",
        type=int,
        default=3,
        help="Supersampling factor for smooth edges.",
    )
    return parser.parse_args()


def hex_to_rgba(value: str, alpha: int = 238) -> tuple[int, int, int, int]:
    value = value.removeprefix("#")
    return (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
        alpha,
    )


def enhance_color(
    color: tuple[int, int, int, int],
    saturation_boost: float = 1.32,
    value_boost: float = 1.42,
    highlight_mix: float = 0.2,
) -> tuple[int, int, int, int]:
    r, g, b, a = color
    h, s, v = colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
    s = max(0.0, min(1.0, s * saturation_boost))
    v = max(0.0, min(1.0, v * value_boost))
    rr, gg, bb = colorsys.hsv_to_rgb(h, s, v)
    return (
        round(lerp(rr * 255, 255, highlight_mix)),
        round(lerp(gg * 255, 255, highlight_mix)),
        round(lerp(bb * 255, 255, highlight_mix)),
        a,
    )


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def apply_rounded_corners(image: Image.Image, radius_ratio: float = 0.12) -> Image.Image:
    rounded = image.copy()
    mask = Image.new("L", rounded.size, 0)
    radius = max(1, round(min(rounded.size) * radius_ratio))
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, rounded.width - 1, rounded.height - 1), radius=radius, fill=255)
    rounded.putalpha(mask)
    return rounded


def load_conic_stops(path: Path) -> list[tuple[float, tuple[int, int, int, int]]]:
    palette = json.loads(path.read_text(encoding="utf-8"))
    temperature = palette["temperature"]
    precipitation = palette["precipitation"]

    temp_cold = enhance_color(hex_to_rgba(temperature[0], 242))
    temp_hot = enhance_color(hex_to_rgba(temperature[-1], 236))
    precip_dry = enhance_color(hex_to_rgba(precipitation[0], 236))
    precip_wet = enhance_color(hex_to_rgba(precipitation[-1], 240))

    return [
        (0.00, precip_wet),
        (0.25, temp_cold),
        (0.50, temp_hot),
        (0.75, precip_dry),
        (1.00, precip_wet),
    ]


def sample_conic(stops: list[tuple[float, tuple[int, int, int, int]]], t: float) -> tuple[float, float, float, float]:
    t = t % 1.0
    for index in range(1, len(stops)):
        left_pos, left_color = stops[index - 1]
        right_pos, right_color = stops[index]
        if t <= right_pos:
            span = right_pos - left_pos or 1.0
            local_t = (t - left_pos) / span
            return tuple(
                lerp(left_color[channel], right_color[channel], local_t)
                for channel in range(4)
            )
    return tuple(float(channel) for channel in stops[-1][1])


def composite(bg: tuple[int, int, int, int], fg: tuple[float, float, float, float], alpha: float) -> tuple[int, int, int, int]:
    fg_alpha = max(0.0, min(1.0, (fg[3] / 255.0) * alpha))
    bg_alpha = bg[3] / 255.0
    out_alpha = fg_alpha + bg_alpha * (1.0 - fg_alpha)
    if out_alpha <= 0:
        return (0, 0, 0, 0)
    inv = 1.0 - fg_alpha
    return (
        round((bg[0] * bg_alpha * inv + fg[0] * fg_alpha) / out_alpha),
        round((bg[1] * bg_alpha * inv + fg[1] * fg_alpha) / out_alpha),
        round((bg[2] * bg_alpha * inv + fg[2] * fg_alpha) / out_alpha),
        round(out_alpha * 255),
    )


def render(size: int, conic_stops: list[tuple[float, tuple[int, int, int, int]]]) -> Image.Image:
    image = Image.new("RGBA", (size, size), BACKGROUND)
    pixels = image.load()

    cx = cy = (size - 1) / 2.0
    outer_radius = size * 0.392
    inner_radius = outer_radius * 0.69
    aa = max(1.0, size * 0.002)

    for y in range(size):
        dy = y - cy
        for x in range(size):
            dx = x - cx
            radius = math.hypot(dx, dy)

            outer_alpha = 1.0 - smoothstep(outer_radius - aa, outer_radius + aa, radius)
            inner_alpha = smoothstep(inner_radius - aa, inner_radius + aa, radius)
            ring_alpha = max(0.0, min(1.0, outer_alpha * inner_alpha))
            if ring_alpha <= 0.0:
                continue

            angle = (math.atan2(dy, dx) + math.pi / 2.0) / (2.0 * math.pi)
            fg = sample_conic(conic_stops, angle)
            pixels[x, y] = composite(BACKGROUND, fg, ring_alpha)

    return image


def main() -> None:
    args = parse_args()
    conic_stops = load_conic_stops(args.palette_config)
    work_size = max(64, args.size * max(1, args.supersample))
    image = render(work_size, conic_stops)
    if work_size != args.size:
        image = image.resize((args.size, args.size), Image.Resampling.LANCZOS)
    image = apply_rounded_corners(image)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, format="PNG")
    print(f"Saved {args.output} ({args.size}x{args.size})")


if __name__ == "__main__":
    main()
