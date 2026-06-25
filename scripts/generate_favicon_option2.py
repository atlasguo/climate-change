from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image


ANGLE_STOPS = [
    (0.00, (32, 46, 110)),
    (0.18, (26, 49, 112)),
    (0.40, (128, 174, 255)),
    (0.58, (220, 160, 164)),
    (0.73, (193, 68, 47)),
    (0.92, (30, 43, 101)),
    (1.00, (32, 46, 110)),
]

BACKGROUND = (16, 21, 36, 255)
CORE = (19, 24, 40, 255)


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
        description="Generate the ring-based option 2 favicon as a PNG asset."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("assets/favicons/favicon-option2.png"),
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
        default=2,
        help="Supersampling factor for smoother edges.",
    )
    return parser.parse_args()


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge0 == edge1:
        return 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - 2.0 * t)


def sample_gradient(stops: list[tuple[float, tuple[int, int, int]]], t: float) -> tuple[int, int, int]:
    t = t % 1.0
    for index in range(1, len(stops)):
        left_pos, left_color = stops[index - 1]
        right_pos, right_color = stops[index]
        if t <= right_pos:
            span = right_pos - left_pos or 1.0
            local_t = (t - left_pos) / span
            return tuple(
                round(lerp(left_color[channel], right_color[channel], local_t))
                for channel in range(3)
            )
    return stops[-1][1]


def render_ring(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), BACKGROUND)
    pixels = image.load()

    cx = cy = (size - 1) / 2.0
    outer_radius = size * 0.355
    ring_width = size * 0.072
    inner_radius = outer_radius - ring_width
    aa = max(1.2, size * 0.0022)

    for y in range(size):
        dy = y - cy
        for x in range(size):
            dx = x - cx
            radius = math.hypot(dx, dy)

            if radius <= inner_radius - aa:
                pixels[x, y] = CORE
                continue

            angle = (math.atan2(dy, dx) + math.pi / 2.0) / (2.0 * math.pi)
            color = sample_gradient(ANGLE_STOPS, angle)

            outer_alpha = 1.0 - smoothstep(outer_radius - aa, outer_radius + aa, radius)
            inner_alpha = smoothstep(inner_radius - aa, inner_radius + aa, radius)
            ring_alpha = max(0.0, min(1.0, outer_alpha * inner_alpha))

            if ring_alpha <= 0.0:
                continue

            r = round(lerp(BACKGROUND[0], color[0], ring_alpha))
            g = round(lerp(BACKGROUND[1], color[1], ring_alpha))
            b = round(lerp(BACKGROUND[2], color[2], ring_alpha))
            pixels[x, y] = (r, g, b, 255)

    return image


def main() -> None:
    args = parse_args()
    work_size = max(64, args.size * max(1, args.supersample))
    image = render_ring(work_size)
    if work_size != args.size:
        image = image.resize((args.size, args.size), Image.Resampling.LANCZOS)
    image = apply_rounded_corners(image)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, format="PNG")
    print(f"Saved {args.output} ({args.size}x{args.size})")


if __name__ == "__main__":
    main()
