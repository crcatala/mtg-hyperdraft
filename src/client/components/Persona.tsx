// How a player's avatar and companion show up around the game: a round face in their accent colour,
// a small companion, and a hover card with the character behind the player's name. The name stays the
// primary identity everywhere; the character is the secondary, flavourful one. Players who haven't
// picked an avatar show as a hooded stranger, and without a companion there's simply none.

import type { CSSProperties } from "react";
import type { Player } from "../../shared/types";
import { accentOf, avatarArt, avatarDef, avatarFace, companionDef, companionSmall, variantHue } from "../roster";
import { Tooltip, type Placement } from "./Tooltip";

export type Looked = Partial<Pick<Player, "avatar" | "avatarVariant" | "companion" | "companionVariant">>;

/** The hover card: character name and title, their line, and who sits beside them. */
export function IdentityCard({ look, playerName }: { look: Looked; playerName?: string }) {
  const a = avatarDef(look.avatar);
  const c = companionDef(look.companion);
  if (!a) return null;
  return (
    <div className="identity-card" style={{ "--c": accentOf(look) } as CSSProperties}>
      <img className="identity-art" src={avatarArt(a.id)} alt="" width={72} height={72} />
      <div className="identity-text">
        {playerName && <span className="identity-player">{playerName} plays as</span>}
        <span className="identity-name">{a.name}</span>
        <span className="identity-title">
          {a.title} · {a.race}
        </span>
        <q className="identity-quote">{a.quote.replace(/^"|"$/g, "")}</q>
        {c && (
          <span className="identity-pet">
            <img src={companionSmall(c.id)} alt="" width={22} height={22} style={petFilter(look.companionVariant)} /> with {c.name} the {c.species}
          </span>
        )}
      </div>
    </div>
  );
}

/** A duplicate companion is shown with its hues turned, so two of the same one can be told apart. */
export function petFilter(variant: number | undefined): CSSProperties | undefined {
  const turn = variantHue(variant ?? 0);
  return turn ? { filter: `hue-rotate(${turn}deg)` } : undefined;
}

/** A round avatar face. Hovering or focusing it reveals the character (turn `tip` off where it would be noise). */
export function PlayerFace({
  player,
  size = 32,
  tip = true,
  placement = "bottom",
  className = "",
  focusable = false,
}: {
  player: Looked & Pick<Player, "name">;
  size?: number;
  tip?: boolean;
  placement?: Placement;
  className?: string;
  focusable?: boolean;
}) {
  const a = avatarDef(player.avatar);
  const face = (
    <span
      className={`pfp${a ? "" : " mystery"} ${className}`}
      style={{ "--c": accentOf(player), width: size, height: size } as CSSProperties}
      tabIndex={focusable ? 0 : undefined}
      role="img"
      aria-label={a ? `${player.name}'s avatar: ${a.name}, ${a.title}` : `${player.name} (no avatar chosen)`}
    >
      <img src={avatarFace(player.avatar)} alt="" draggable={false} />
    </span>
  );
  if (!tip || !a) return face;
  return (
    <Tooltip placement={placement} content={<IdentityCard look={player} playerName={player.name} />}>
      {face}
    </Tooltip>
  );
}

/** A player's companion as a small picture, named on hover. Nothing if they haven't chosen one. */
export function CompanionIcon({ player, size = 32, placement = "bottom" }: { player: Looked; size?: number; placement?: Placement }) {
  const c = companionDef(player.companion);
  if (!c) return null;
  return (
    <Tooltip
      placement={placement}
      content={
        <span className="pet-tip">
          <span className="pet-tip-name">{c.name}</span> · {c.species}
          <br />
          <span className="pet-tip-sub">{c.personality}</span>
        </span>
      }
    >
      <span className="pet" style={{ "--c": c.color, width: size, height: size } as CSSProperties} role="img" aria-label={`Companion: ${c.name} the ${c.species}`}>
        <img src={companionSmall(c.id)} alt="" draggable={false} style={petFilter(player.companionVariant)} />
      </span>
    </Tooltip>
  );
}
