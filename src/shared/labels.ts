import type { PieceType } from "./game.ts";

export function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

export function pieceLetter(type: PieceType): string {
  return type === "knight" ? "N" : type[0].toUpperCase();
}
