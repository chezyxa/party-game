export interface DieFace {
  move: number;
  coins?: number;
}

export interface CharacterDef {
  id: string;
  name: string;
  species: string;
  color: string;
  dice: DieFace[];
  diceDesc: string;
}

const f = (move: number, coins?: number): DieFace => (coins ? { move, coins } : { move });

export const CHARACTERS: CharacterDef[] = [
  {
    id: 'kapi',
    name: 'Капи',
    species: 'капибара',
    color: '#e67e22',
    dice: [f(4), f(4), f(4), f(4), f(5), f(5)],
    diceDesc: 'Невозмутимый кубик: всегда 4 или 5',
  },
  {
    id: 'tiko',
    name: 'Тико',
    species: 'тукан',
    color: '#2f86d6',
    dice: [f(2), f(4), f(4), f(4), f(6), f(8)],
    diceDesc: 'Сбалансированный кубик: 2, 4, 4, 4, 6, 8',
  },
  {
    id: 'kvaka',
    name: 'Квака',
    species: 'лягушка',
    color: '#27ae60',
    dice: [f(1), f(1), f(1), f(8), f(9), f(10)],
    diceDesc: 'Прыгучий кубик: либо 1, либо 8–10',
  },
  {
    id: 'tora',
    name: 'Тора',
    species: 'черепаха',
    color: '#8e44ad',
    dice: [f(0, 3), f(0, 3), f(3), f(5), f(5), f(7)],
    diceDesc: 'Копилка: 0 шагов +3 монеты (×2), 3, 5, 5, 7',
  },
  {
    id: 'kleshnya',
    name: 'Клешня',
    species: 'краб',
    color: '#e74c3c',
    dice: [f(8), f(8), f(8), f(8), f(0, -3), f(0, -3)],
    diceDesc: 'Рисковый: 8 шагов (×4) или −3 монеты (×2)',
  },
  {
    id: 'mimi',
    name: 'Мими',
    species: 'обезьянка',
    color: '#e84393',
    dice: [f(0, 5), f(2), f(3), f(7), f(7), f(7)],
    diceDesc: 'Озорной: 0 шагов +5 монет, 2, 3, 7, 7, 7',
  },
];

export const CHAR_BY_ID: Record<string, CharacterDef> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

export function faceLabel(face: DieFace): string {
  if (face.coins) return `${face.coins > 0 ? '+' : ''}${face.coins}💰`;
  return String(face.move);
}
