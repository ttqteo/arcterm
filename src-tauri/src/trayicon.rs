//! The menu bar / tray icon's pixels and the popover's place (spec 2026-10-15-tray-popover-design.md), pure so they
//! test without a window. The glyph is the "t>" mark's 12x9 cell grid, mirrored from scripts/gen-app-icon.mjs CELLS;
//! drawing it here lets the count badge, the red dot and the dimming compose onto it with no PNG per state.

// [cx, cy, cw, ch] runs of cells: the t (stem, crossbar, hook, base), then the chevron's nine blocks
const CELLS: [(u32, u32, u32, u32); 13] = [
    (1, 1, 1, 6),
    (0, 3, 5, 1),
    (5, 6, 1, 1),
    (2, 7, 3, 1),
    (7, 0, 1, 1),
    (8, 1, 1, 1),
    (9, 2, 1, 1),
    (10, 3, 1, 1),
    (11, 4, 1, 1),
    (10, 5, 1, 1),
    (9, 6, 1, 1),
    (8, 7, 1, 1),
    (7, 8, 1, 1),
];

// the icon is an image, not themed UI: these are the @theme values it mirrors (asking, on-warning, error)
const AMBER: [u8; 3] = [0xff, 0xc1, 0x07];
const ON_AMBER: [u8; 3] = [0x1a, 0x13, 0x01];
const RED: [u8; 3] = [0xff, 0x6b, 0x80];
const WHITE: [u8; 4] = [0xff, 0xff, 0xff, 0xff];
const BLACK: [u8; 4] = [0, 0, 0, 0xff];
const DIM: f32 = 0.45;

// 3x5 digits for the badge, one row per byte, high bit on the left
const DIGITS: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111],
    [0b010, 0b110, 0b010, 0b010, 0b111],
    [0b111, 0b001, 0b111, 0b100, 0b111],
    [0b111, 0b001, 0b111, 0b001, 0b111],
    [0b101, 0b101, 0b111, 0b001, 0b001],
    [0b111, 0b100, 0b111, 0b001, 0b111],
    [0b111, 0b100, 0b111, 0b101, 0b111],
    [0b111, 0b001, 0b001, 0b001, 0b001],
    [0b111, 0b101, 0b111, 0b101, 0b111],
    [0b111, 0b101, 0b111, 0b001, 0b111],
];
const PLUS: [u8; 5] = [0b000, 0b010, 0b111, 0b010, 0b000];

pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub px: Vec<u8>,
}

impl Rgba {
    fn blank(width: u32, height: u32) -> Rgba {
        Rgba { width, height, px: vec![0; (width * height * 4) as usize] }
    }

    fn set(&mut self, x: u32, y: u32, c: [u8; 4]) {
        if x < self.width && y < self.height {
            let i = ((y * self.width + x) * 4) as usize;
            self.px[i..i + 4].copy_from_slice(&c);
        }
    }

    fn blit(&mut self, src: &Rgba, ox: u32, oy: u32) {
        for y in 0..src.height {
            for x in 0..src.width {
                let i = ((y * src.width + x) * 4) as usize;
                if src.px[i + 3] > 0 {
                    self.set(ox + x, oy + y, [src.px[i], src.px[i + 1], src.px[i + 2], src.px[i + 3]]);
                }
            }
        }
    }

    fn disc(&mut self, cx: f32, cy: f32, r: f32, rgb: [u8; 3]) {
        for y in 0..self.height {
            for x in 0..self.width {
                let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
                if dx * dx + dy * dy <= r * r {
                    self.set(x, y, [rgb[0], rgb[1], rgb[2], 0xff]);
                }
            }
        }
    }

    fn fade(&mut self, f: f32) {
        for p in self.px.chunks_mut(4) {
            p[3] = (p[3] as f32 * f).round() as u8;
        }
    }
}

/// The mark, `step` px per cell, in `color` on transparent.
pub fn glyph(step: u32, color: [u8; 4]) -> Rgba {
    let mut g = Rgba::blank(12 * step, 9 * step);
    for &(cx, cy, cw, ch) in CELLS.iter() {
        for y in cy * step..(cy + ch) * step {
            for x in cx * step..(cx + cw) * step {
                g.set(x, y, color);
            }
        }
    }
    g
}

/// macOS: the template image, a 36 px square the menu bar shows 18 pt high, with the mark 3 px a cell across its middle:
/// 13.5 pt tall on a Retina screen, the size of the icons beside it (4 px a cell filled all 18 pt and stood out).
pub fn mac_icon(dim: bool) -> Rgba {
    let g = glyph(3, BLACK);
    let mut out = Rgba::blank(36, 36);
    out.blit(&g, 0, (36 - g.height) / 2);
    if dim {
        out.fade(DIM);
    }
    out
}

/// Windows: the white mark centred in a size x size square, the needs-you badge bottom right with the count, and the
/// red dot top right when memory pressure is critical. `dim` is wavesrv gone: offline drops the count, so the dimmed
/// icon is the glyph alone, faded, with no badge and no red dot.
pub fn win_icon(size: u32, count: u32, alert: bool, dim: bool) -> Rgba {
    let mut out = Rgba::blank(size, size);
    let g = glyph((size / 12).max(1), WHITE);
    out.blit(&g, (size - g.width.min(size)) / 2, (size - g.height.min(size)) / 2);
    if dim {
        out.fade(DIM);
        return out;
    }
    let s = size as f32;
    if alert {
        out.disc(s - s * 0.19, s * 0.19, s * 0.19, RED);
    }
    let text = badge_text(count);
    if !text.is_empty() {
        let r = s * 0.31;
        let (cx, cy) = (s - r, s - r);
        out.disc(cx, cy, r, AMBER);
        let k = (size / 16).max(1);
        let glyphs: Vec<[u8; 5]> = text
            .chars()
            .map(|c| c.to_digit(10).map(|d| DIGITS[d as usize]).unwrap_or(PLUS))
            .collect();
        let tw = glyphs.len() as u32 * 3 * k + (glyphs.len() as u32 - 1) * k;
        let (ox, oy) = ((cx - tw as f32 / 2.0).round() as u32, (cy - 2.5 * k as f32).round() as u32);
        for (n, rows) in glyphs.iter().enumerate() {
            let gx = ox + n as u32 * 4 * k;
            for (ry, bits) in rows.iter().enumerate() {
                for bx in 0..3u32 {
                    if bits & (0b100 >> bx) != 0 {
                        for yy in 0..k {
                            for xx in 0..k {
                                out.set(gx + bx * k + xx, oy + ry as u32 * k + yy, [ON_AMBER[0], ON_AMBER[1], ON_AMBER[2], 0xff]);
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

/// The tray's icon size for a monitor scale: 16 px at 100 %, then 20, 24 and 32.
pub fn win_icon_size(scale: f64) -> u32 {
    let want = (16.0 * scale).round() as u32;
    [16, 20, 24, 32].into_iter().find(|s| want <= *s).unwrap_or(32)
}

pub fn badge_text(count: u32) -> String {
    match count {
        0 => String::new(),
        1..=9 => count.to_string(),
        _ => "9+".to_string(),
    }
}

/// What leads the macOS title at critical memory pressure: a dot Task 4 colours red through the status item's
/// attributed title, or "!" when that cannot be done (the spec's fallback, `! 4`).
pub const MAC_ALERT: &str = "●";

/// The text beside the macOS glyph.
pub fn mac_title(count: u32, alert: bool, offline: bool) -> String {
    match (offline, alert, count) {
        (true, _, _) => String::new(),
        (false, true, 0) => MAC_ALERT.to_string(),
        (false, true, n) => format!("{MAC_ALERT} {n}"),
        (false, false, 0) => String::new(),
        (false, false, n) => n.to_string(),
    }
}

pub fn tooltip(count: u32, alert: bool, offline: bool) -> String {
    if offline {
        return "arcterm: its server is not answering".to_string();
    }
    let mut parts = Vec::new();
    if alert {
        parts.push("memory pressure critical".to_string());
    }
    if count > 0 {
        parts.push(format!("{count} waiting on you"));
    }
    if parts.is_empty() {
        "arcterm".to_string()
    } else {
        format!("arcterm: {}", parts.join(", "))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct R {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

const GAP: f64 = 8.0;

/// Where the popover's top-left goes, in physical px: centred under the icon when it sits in the top half of the work
/// area (the macOS menu bar, a top taskbar), over it otherwise (a bottom taskbar), beside it on a side taskbar, and
/// always inside the work area by GAP.
pub fn popover_origin(icon: R, size: (f64, f64), work: R) -> (f64, f64) {
    let (w, h) = size;
    let cx = icon.x + icon.w / 2.0;
    let cy = icon.y + icon.h / 2.0;
    let (mut x, mut y) = if icon.x + icon.w <= work.x {
        (work.x + GAP, cy - h / 2.0) // a left taskbar: the work area starts right of it
    } else if icon.x >= work.x + work.w {
        (work.x + work.w - w - GAP, cy - h / 2.0) // a right taskbar
    } else if cy < work.y + work.h / 2.0 {
        (cx - w / 2.0, icon.y + icon.h + GAP)
    } else {
        (cx - w / 2.0, icon.y - h - GAP)
    };
    x = x.min(work.x + work.w - w - GAP).max(work.x + GAP);
    y = y.min(work.y + work.h - h - GAP).max(work.y + GAP);
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha(img: &Rgba, x: u32, y: u32) -> u8 {
        img.px[((y * img.width + x) * 4 + 3) as usize]
    }

    fn has_color(img: &Rgba, rgb: [u8; 3]) -> bool {
        img.px.chunks(4).any(|p| p[0] == rgb[0] && p[1] == rgb[1] && p[2] == rgb[2] && p[3] > 0)
    }

    #[test]
    fn glyph_is_the_mark_grid() {
        let g = glyph(1, [255, 255, 255, 255]);
        assert_eq!((g.width, g.height), (12, 9));
        assert_eq!(alpha(&g, 1, 1), 255); // the t's stem
        assert_eq!(alpha(&g, 11, 4), 255); // the chevron's point
        assert_eq!(alpha(&g, 0, 0), 0);
        assert_eq!(alpha(&g, 11, 0), 0);
    }

    #[test]
    fn mac_icon_is_a_36_px_black_template_with_the_mark_at_3_px_a_cell() {
        let m = mac_icon(false);
        assert_eq!((m.width, m.height), (36, 36));
        // 27 px of mark between 4 px of air above and 5 below
        assert!((0..36).all(|x| (0..4).chain(31..36).all(|y| alpha(&m, x, y) == 0)));
        assert_eq!(alpha(&m, 3, 7), 255); // the t's stem, cell (1, 1)
        assert_eq!(alpha(&m, 35, 16), 255); // the chevron's point, cell (11, 4)
        assert_eq!(alpha(&m, 2, 7), 0);
        assert!(m.px.chunks(4).all(|p| p[3] == 0 || (p[0], p[1], p[2]) == (0, 0, 0)));
        assert!(mac_icon(true).px.chunks(4).all(|p| p[3] <= 115)); // dimmed to 45%
    }

    #[test]
    fn win_icon_is_square_with_a_badge_only_for_a_count() {
        let plain = win_icon(16, 0, false, false);
        assert_eq!((plain.width, plain.height), (16, 16));
        assert!(!has_color(&plain, AMBER));
        assert!(has_color(&win_icon(16, 4, false, false), AMBER));
        assert!(has_color(&win_icon(32, 12, false, false), AMBER));
        assert!(has_color(&win_icon(16, 0, true, false), RED));
        assert!(!has_color(&win_icon(16, 4, false, false), RED));
    }

    #[test]
    fn dimmed_win_icon_is_the_glyph_alone() {
        let off = win_icon(16, 4, true, true);
        assert!(!has_color(&off, AMBER));
        assert!(!has_color(&off, RED));
        assert!(off.px.chunks(4).any(|p| p[3] > 0));
    }

    #[test]
    fn badge_text_caps_at_nine() {
        assert_eq!(badge_text(0), "");
        assert_eq!(badge_text(4), "4");
        assert_eq!(badge_text(9), "9");
        assert_eq!(badge_text(12), "9+");
    }

    #[test]
    fn win_icon_size_follows_the_scale() {
        assert_eq!(win_icon_size(1.0), 16);
        assert_eq!(win_icon_size(1.25), 20);
        assert_eq!(win_icon_size(1.5), 24);
        assert_eq!(win_icon_size(1.75), 32);
        assert_eq!(win_icon_size(2.0), 32);
    }

    #[test]
    fn mac_title_and_tooltip() {
        assert_eq!(mac_title(0, false, false), "");
        assert_eq!(mac_title(4, false, false), "4");
        assert_eq!(mac_title(12, false, false), "12");
        assert_eq!(mac_title(4, true, false), format!("{MAC_ALERT} 4"));
        assert_eq!(mac_title(0, true, false), MAC_ALERT);
        assert_eq!(mac_title(4, true, true), "");
        assert_eq!(tooltip(0, false, false), "arcterm");
        assert_eq!(tooltip(4, true, false), "arcterm: memory pressure critical, 4 waiting on you");
        assert_eq!(tooltip(1, false, false), "arcterm: 1 waiting on you");
        assert_eq!(tooltip(4, false, true), "arcterm: its server is not answering");
    }

    const MAC_WORK: R = R { x: 0.0, y: 50.0, w: 2880.0, h: 1750.0 }; // below a 50 px (@2x) menu bar
    const WIN_WORK: R = R { x: 0.0, y: 0.0, w: 1920.0, h: 1032.0 }; // above a 48 px taskbar

    #[test]
    fn popover_hangs_under_the_mac_menu_bar() {
        let icon = R { x: 2000.0, y: 0.0, w: 48.0, h: 48.0 };
        let (x, y) = popover_origin(icon, (720.0, 1180.0), MAC_WORK);
        assert_eq!(x, 2024.0 - 360.0);
        assert_eq!(y, 58.0); // inside the work area, 8 px under its top
    }

    #[test]
    fn popover_stands_on_a_bottom_taskbar() {
        let icon = R { x: 1700.0, y: 1040.0, w: 24.0, h: 32.0 };
        let (x, y) = popover_origin(icon, (360.0, 590.0), WIN_WORK);
        assert_eq!(y, 1032.0 - 590.0 - 8.0); // GAP above the work area's bottom, the taskbar's top
        assert_eq!(x, 1712.0 - 180.0);
    }

    #[test]
    fn popover_hangs_from_a_top_taskbar() {
        let work = R { x: 0.0, y: 48.0, w: 1920.0, h: 1032.0 };
        let icon = R { x: 1700.0, y: 8.0, w: 24.0, h: 32.0 };
        let (_, y) = popover_origin(icon, (360.0, 590.0), work);
        assert_eq!(y, 56.0);
    }

    #[test]
    fn popover_sits_beside_a_side_taskbar() {
        let left_work = R { x: 62.0, y: 0.0, w: 1858.0, h: 1080.0 };
        let icon = R { x: 15.0, y: 900.0, w: 32.0, h: 24.0 };
        let (x, y) = popover_origin(icon, (360.0, 590.0), left_work);
        assert_eq!(x, 70.0);
        assert!(y >= 8.0 && y + 590.0 <= 1072.0);
        let right_work = R { x: 0.0, y: 0.0, w: 1858.0, h: 1080.0 };
        let icon = R { x: 1873.0, y: 900.0, w: 32.0, h: 24.0 };
        let (x, _) = popover_origin(icon, (360.0, 590.0), right_work);
        assert_eq!(x, 1858.0 - 360.0 - 8.0);
    }

    #[test]
    fn popover_stays_inside_at_the_screen_edge() {
        let icon = R { x: 1900.0, y: 1040.0, w: 20.0, h: 32.0 };
        let (x, _) = popover_origin(icon, (360.0, 590.0), WIN_WORK);
        assert_eq!(x, 1920.0 - 360.0 - 8.0);
        let tall = popover_origin(icon, (360.0, 5000.0), WIN_WORK);
        assert_eq!(tall.1, 8.0);
    }
}
