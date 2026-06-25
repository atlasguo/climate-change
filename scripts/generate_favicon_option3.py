from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


BACKGROUND = (2, 7, 11, 255)

# Matches the CSS loading halo in css/styles.css
CSS_CONIC_STOPS = [
    (0.0, (255, 255, 255, 10)),
    (0.2, (10, 42, 111, 240)),
    (0.4, (127, 191, 255, 245)),
    (0.6, (214, 74, 50, 230)),
    (0.8, (111, 13, 13, 219)),
    (1.0, (255, 255, 255, 10)),
]


def apply_rounded_corners(image: Image.Image, radius_ratio: float = 0.085) -> Image.Image:
    rounded = image.copy()
    mask = Image.new("L", rounded.size, 0)
    radius = max(1, round(min(rounded.size) * radius_ratio))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, rounded.width - 1, rounded.height - 1), radius=radius, fill=255)
    rounded.putalpha(mask)
    return rounded


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate favicon option 3 from the map loading ring."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/favicons/favicon-option3.png"),
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


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


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
    inv = 1.0 - fg_alpha
    return (
        round(bg[0] * inv + fg[0] * fg_alpha),
        round(bg[1] * inv + fg[1] * fg_alpha),
        round(bg[2] * inv + fg[2] * fg_alpha),
        255,
    )


def render(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), BACKGROUND)
    pixels = image.load()

    cx = cy = (size - 1) / 2.0
    outer_radius = size * 0.355
    inner_radius = outer_radius * 0.54
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
            fg = sample_conic(CSS_CONIC_STOPS, angle)
            pixels[x, y] = composite(BACKGROUND, fg, ring_alpha)

    return image


def main() -> None:
    args = parse_args()
    work_size = max(64, args.size * max(1, args.supersample))
    image = render(work_size)
    if work_size != args.size:
        image = image.resize((args.size, args.size), Image.Resampling.LANCZOS)
    image = apply_rounded_corners(image)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, format="PNG")
    print(f"Saved {args.output} ({args.size}x{args.size})")


if __name__ == "__main__":
    main()
