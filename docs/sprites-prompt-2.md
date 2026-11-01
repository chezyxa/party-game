# Промпты: остров, клетки поля и интерфейс

Нужно две картинки:

1. **Остров** (`public/sprites/island.webp` или `.png`). Растягивается на всю доску, поэтому ему нужен весь холст: в общей сетке он вышел бы мелким и мыльным при приближении.
2. **Лист интерфейса** (`public/sprites/ui.webp` или `.png`): сетка 6×4 из клеток поля, фруктов, кубика, таблички и прочего.

Дорожки, клетки и фишки игра рисует поверх острова сама, поэтому на острове их быть не должно.

---

## 1. Остров

**Обязательно приложите к сообщению картинку [`docs/island-guide.png`](island-guide.png)** — это схема: где берег, где проходят дорожки (белые точки) и где вулкан. Без неё дорожки лягут куда попало.

```
Use the attached image ONLY as a layout guide: keep the exact island silhouette, the position of the volcano
in the center, and the wide sandy beach ring exactly where the dotted white path runs.
Do NOT draw the dots, the white path lines or the red dots — the game draws its own path on top.

Create a top-down (slightly tilted, 3/4 bird's-eye) illustration of a tropical island for a cute party board game,
1536×1024 pixels, landscape, the island filling the canvas exactly like in the guide.

- Turquoise ocean all around with gentle wave highlights; the outer 6% of the image is plain calm ocean
  (same color everywhere at the edges, no objects there) so it blends into the game's ocean.
- A light-turquoise shallow-water ring and white foam along the shore.
- A broad, smooth, mostly empty sandy beach ring where the path goes (keep it clear and fairly flat —
  only a few small shells, starfish, footprints).
- Inside: lush jungle with palm trees, ferns, tropical flowers, a small waterfall and a pond, a couple of tiki statues,
  a little bamboo hut; keep clear, slightly lighter grassy corridors where the two inner paths of the guide run.
- In the exact center: a friendly cartoon volcano with a glowing lava crater and a soft smoke puff.
- Bottom-left: open water where the guide's red dots are (the game draws a wooden pier there) — no land, no objects.
- No text, no logos, no characters, no UI.

Art style: original cute cartoon style matching a mobile party game — bold clean dark-brown outlines,
bright saturated colors, soft cel shading, lighting from the top-left. Original design: NOT Nintendo/Mario.
```

---

## 2. Лист интерфейса (6×4)

```
Create a single sprite sheet image, 1536×1024 pixels, with a FULLY TRANSPARENT background.
Strict grid of 6 columns × 4 rows; every cell is exactly 256×256 pixels.
Each cell contains ONE centered object filling about 85% of the cell; nothing crosses cell borders.
No grid lines, no labels, no text or letters anywhere, no background shadows.

Art style: original cute cartoon style for a tropical-island party board game — bold clean dark-brown outlines,
bright saturated colors, soft cel shading, lighting from the top-left, same scale and outline thickness everywhere.
Original designs only: NOT Nintendo, NOT Mario, no existing franchise elements.

Rows 1–2, cells 1–9: ROUND BOARD-GAME SPACES seen from straight above — thick polished round stone/wood tiles
with a light rim and a slight 3D bevel, all exactly the same size and shape, each with one big simple symbol in the middle:
 1. Blue tile with a white plus sign (gain coins)
 2. Red tile with a white minus sign (lose coins)
 3. Green tile with a white question mark (random event)
 4. Light-green tile with a four-leaf clover (lucky)
 5. Dark-purple tile with a white pirate skull and crossed bones (villain)
 6. Orange tile with two crossed cartoon swords (duel)
 7. Teal tile with a small gold coin stack (bank)
 8. Yellow tile with a tiny market stall awning (shop)
 9. Brown tile with a monkey paw print (thief)

Row 2, cells 10–12:
10. A blank wooden game die seen straight from the front: one rounded-square face, empty in the middle (no pips)
11. A shiny golden trophy cup with a palm-leaf decoration
12. A wooden direction signpost with one arrow-shaped plank pointing right (no text)

Row 3:
13. A banana   14. A mango   15. A pineapple   16. A rotten moldy greenish fruit with a fly
17. A coconut   18. A red cartoon crab seen from above (claws up)

Row 4:
19. A colorful tropical fish facing RIGHT
20. A round leafy jungle bush
21. A card back: a rounded-rectangle tile with a seashell pattern (front view)
22. A sparkling faceted gemstone
23. A wide horizontal wooden plank signboard (blank, no text), filling the cell width, about 1/3 of the cell height
24. A blank aged parchment paper sheet with slightly curled edges (front view, no text)
```

---

## Куда класть

- `public/sprites/island.webp` (или `.png` / `.jpg`)
- `public/sprites/ui.webp` (или `.png`) — раскладка 6×4, порядок задан в `src/client/art.ts` (`GRID_UI`).

Если сетка выйдет неровной, пришлите картинку: я выровняю и нарежу её, как первый лист.

Что поменяется в игре:
- клетки поля рисуются этими тайлами;
- кубик, табличка баннера и пергамент карточек событий берутся из листа;
- в мини-играх появятся фрукты, крабы, рыбы, кусты и рубашки карт;
- на финале — кубок, на развилках — указатель.

Без этих файлов игра рисует всё по-старому.
