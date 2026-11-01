Сюда кладутся спрайты: `sheet.png` + `sheet.json`.
Если файлов нет, игра рисует всё процедурно.

Формат `sheet.json`:
```json
{ "image": "sheet.png", "frames": { "char_kapi": { "x": 0, "y": 0, "w": 256, "h": 256 } } }
```
Имена кадров: char_kapi, char_tiko, char_kvaka, char_tora, char_kleshnya, char_mimi,
star, coin, icon_<имя> (double, triple, custom, shell, swap, paw, trap, villain, thief, shop, bank, ...).
