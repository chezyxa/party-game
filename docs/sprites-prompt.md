# Промпт для генерации спрайтов (ChatGPT / любая генерация картинок)

Игра сейчас рисует всё процедурно. Если положить картинку `public/sprites/sheet.png`, сделанную по сетке ниже, игра автоматически возьмёт персонажей и иконки из неё. Никаких дополнительных файлов не нужно.

## Промпт (вставлять целиком, на английском — так модели лучше держат сетку)

```
Create a single sprite sheet image, 1536×1024 pixels, with a FULLY TRANSPARENT background.
The sheet is a strict grid of 6 columns × 4 rows; every cell is exactly 256×256 pixels.
Each cell contains ONE centered object that fills about 85% of the cell, with nothing crossing the cell borders.
No grid lines, no labels, no text, no shadows on the background.

Art style: original cute cartoon style for a tropical-island party board game — bold clean dark-brown outlines,
flat bright colors with soft cel shading, big friendly eyes, chunky rounded shapes, consistent lighting from the top-left.
Original designs only: NOT Nintendo, NOT Mario, no existing franchise characters or logos.

Row 1 — six playable characters, head-and-shoulders portraits facing the viewer, each fits inside a circle:
 1. Kapi — calm capybara, brown fur, sleepy half-closed eyes, a small orange mandarin balanced on its head
 2. Tiko — toucan, black feathers, cream throat, huge orange-yellow beak with a red tip, blue eye ring
 3. Kvaka — round green tree frog with big bulging eyes on top, pink cheeks, wide grin
 4. Tora — friendly green sea turtle with a dark green hexagon-patterned shell behind its head, rosy cheeks
 5. Kleshnya — red crab with eyes on stalks, both claws raised happily
 6. Mimi — mischievous brown monkey with a beige heart-shaped face and a pink hibiscus flower behind the ear

Row 2 — collectibles and NPCs:
 7. Star — a golden smiling starfish with small orange dots (the main collectible)
 8. Coin — a shiny gold coin with a seashell emblem
 9. Captain Barracuda — villain: a grumpy barracuda fish wearing a pirate tricorn hat and an eyepatch
10. Thief monkey — a sneaky little monkey in a striped bandit mask holding a sack
11. Parrot shopkeeper — a colorful macaw with a tiny merchant apron
12. Turtle banker — an old wise tortoise with round glasses and a coin purse

Row 3 — item icons:
13. Two wooden dice tumbling together
14. Three golden dice in a stack
15. A die with a target/bullseye on its face
16. A glowing magic pink conch shell with sparkles
17. A rolled parchment scroll with two curved swap arrows
18. A furry monkey paw grabbing a coin

Row 4 — more icons:
19. A small bear trap (cartoon, not scary)
20. A wooden treasure chest with gold coins peeking out
21. A four-leaf clover
22. A single palm tree with coconuts
23. A cute volcano with a small puff of smoke
24. A tiki tribal drum with drumsticks

Keep every object fully inside its own cell, same scale and same outline thickness across the whole sheet.
```

## Если ChatGPT не делает прозрачный фон

Попросите однотонный фон `#FF00FF` (маджента) — я вырежу его скриптом. Если сетка получилась неровной, просто пришлите картинку: я сам нарежу кадры и сделаю `sheet.json`.

## Куда класть

`public/sprites/sheet.png` — в той же раскладке 6×4. Порядок кадров задан в `src/client/art.ts` (`GRID_NAMES`).
