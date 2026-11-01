export type ItemId = 'double' | 'triple' | 'custom' | 'shell' | 'swap' | 'paw' | 'trap';

export interface ItemDef {
  id: ItemId;
  name: string;
  price: number;
  desc: string;
  /** Заменяет обычный бросок кубика. */
  dice?: boolean;
  /** Требует выбрать другого игрока. */
  target?: boolean;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  double: { id: 'double', name: 'Двойной кубик', price: 10, desc: 'Бросаешь два кубика 1–10 и складываешь.', dice: true },
  triple: { id: 'triple', name: 'Тройной кубик', price: 18, desc: 'Бросаешь три кубика 1–10 и складываешь.', dice: true },
  custom: { id: 'custom', name: 'Кубик-выбор', price: 8, desc: 'Сам выбираешь, на сколько клеток пойти (1–10).', dice: true },
  shell: { id: 'shell', name: 'Волшебная ракушка', price: 25, desc: 'Переносит прямо к звезде. Потом ход продолжается.' },
  swap: { id: 'swap', name: 'Свиток обмена', price: 12, desc: 'Меняешься местами с выбранным игроком.', target: true },
  paw: { id: 'paw', name: 'Лапа воришки', price: 12, desc: 'Крадёшь 5–15 монет у выбранного игрока.', target: true },
  trap: { id: 'trap', name: 'Капкан', price: 8, desc: 'Ставишь капкан на свою клетку. Кто встанет на неё, отдаст тебе 10 монет.' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];
export const MAX_ITEMS = 3;
