// Inline SVG icon from our own set (see ../icons.ts). Sized 1em and coloured with currentColor, so it
// follows the surrounding text; override with CSS (`font-size`, `color`, `--icon-stroke`).

import type { CSSProperties } from "react";
import { ICONS, type IconName, type IconPart } from "../icons";

export function Icon({ name, title, className, style }: { name: IconName; title?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ""}`} style={style} viewBox="0 0 24 24" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      {title && <title>{title}</title>}
      {(ICONS[name] as IconPart[]).map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ? "currentColor" : "none"} stroke={!p.fill || p.stroke ? "currentColor" : "none"} />
      ))}
    </svg>
  );
}
