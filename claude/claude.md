# Atestat 2026 — Описание проекта для Claude

## Что это за проект

Генератор аттестатов (дипломов) в PDF для **Уральского гуманитарно-технического колледжа**.  
Поддерживает **казахскую (kz)** и **русскую (ru)** версии.  
Пользователь загружает Excel-ведомость → приложение рендерит аттестат → скачивает PDF.

---

## Стек технологий

- **React 18** + **Vite** + **Tailwind CSS 3**
- **jsPDF** — создание PDF-файла
- **html2canvas** — рендер HTML-страницы в canvas для PDF
- **JSZip** — пакетная генерация (ZIP с несколькими PDF)
- **SheetJS (XLSX)** — парсинг Excel-файла

---

## Структура проекта

```
Atestat 2026 v6/
├── react-generator/          ← весь React-проект
│   ├── src/
│   │   └── App.jsx           ← ГЛАВНЫЙ файл (весь код в одном файле)
│   ├── public/
│   │   ├── data/             ← шаблоны-изображения A4
│   │   │   ├── template_kz.jpg
│   │   │   ├── template_kz_2.jpg
│   │   │   ├── template_ru_fixed.jpg
│   │   │   └── template_ru_2_fixed.jpg
│   │   ├── fonts/
│   │   │   ├── arial.ttf
│   │   │   └── arialbd.ttf
│   │   ├── logo.png
│   │   └── test.xlsx         ← тестовые данные
│   └── package.json
├── .claude/
│   └── launch.json           ← конфиг запуска dev-сервера
└── claude/
    └── claude.md             ← этот файл
```

---

## Запуск

```bash
cd react-generator
npm run dev
# → http://localhost:5173
```

Или через Claude Code: `.claude/launch.json` → конфигурация `react-generator`.  
**npm путь**: `/usr/local/bin/npm` (абсолютный, иначе preview_start не стартует).

---

## Архитектура App.jsx

### Константы
```js
PAGE_W = 841.89 pt   // A4 landscape ширина
PAGE_H = 595.28 pt   // A4 landscape высота
MM     = 2.835432    // 1 мм в pt
```

### Система координат
Используется **ReportLab bottom-origin**: Y=0 внизу страницы.  
Перевод в CSS: `rl(y) = PAGE_H - y`  
Чем больше Y → тем выше на странице → тем меньше CSS `top`.

### Ключевые функции

#### `getPage1Layout(lang, forPdf = false)`
Возвращает X/Y координаты всех полей Листа 1:
- `name_x/y` — ФИО студента
- `doc_x/y` — номер документа
- `sx/sy`, `ex/ey` — годы обучения (начало/конец)
- `inst_x/y` — учреждение
- `spec_x/y` — специальность
- `qual_x/y` — квалификация
- `qual2_x/y` — вторая строка квалификации

**`forPdf = true`** добавляет `+2mm` ко всем Y — компенсация смещения html2canvas  
(html2canvas рендерит глифы ~2мм ниже, чем браузер визуально).

Язык-специфичные поправки:
- `kz`: небольшие сдвиги doc, годов, inst, spec, qual
- `ru`: более крупные сдвиги (другой шаблон)

#### `calculateLayout(student, lang)`
Рассчитывает позиции **всех строк таблицы оценок** (модули + предметы).

**4 области (areas)** — колонки на двух листах:
```
areas[0]: Лист 1, левая  (x=24,       yStart≈280+3mm)
areas[1]: Лист 1, правая (x=448,      yStart≈563+3mm)
areas[2]: Лист 2, левая  (x=21+1mm,   yStart≈565+3mm)
areas[3]: Лист 2, правая (x=448+1mm,  yStart≈565+3mm)
```

Язык-специфичные поправки `yStart` (RU):
- areas[0].yStart -= 3.5mm
- areas[1].yStart -= 1mm
- areas[2].yStart += 0.5mm
- areas[3].yStart += 1mm

`yLimit` (нижняя граница переноса) для обоих языков:
- areas[0].yLimit += 2mm (Лист 1 левая)
- areas[1].yLimit += 2mm (Лист 1 правая)

Если элемент не помещается — переходит в следующую область автоматически.

Каждый item содержит:
- `hoursOffX` — X-смещение колонки «часы» (разное для Листа 1 и 2)
- `creditsOffX` — X-смещение колонки «кредиты»
- `tradOffX` — X-смещение колонки «традиционное оценивание»
  - Лист 1: `339.3 - 2mm`
  - Лист 2: `339.3 - 1mm`
- `subjectOffX` — X-смещение колонки «предмет»
  - Лист 1: `20 - 1mm`
  - Лист 2: `20`

Заголовок модуля переносится строкой только если > **75 символов**.

#### `AttestatPage({ student, pageNum, lang, template, items, noTemplate })`
React-компонент одного листа A4.  
- `noTemplate=false` → предпросмотр (с фоновым JPG-шаблоном)
- `noTemplate=true` → PDF-режим (белый фон, +2mm Y-смещение через `forPdf`)

В PDF-режиме все позиции дополнительно сдвигаются вверх:
- Лист 1 поля: через `forPdf` в `getPage1Layout`
- Оценки: `pdfShift = 2mm` вычитается из CSS `top`

#### `renderPageToCanvas(el)`
`html2canvas(el, { scale: 2 })` → canvas для PDF без шаблона.

#### `renderPageToCanvasComposite(textEl, templateSrc)`
1. `html2canvas` текстового слоя (белый фон, scale:2)
2. Загрузка JPG-шаблона через `new Image()`
3. `ctx.drawImage(template)` → `ctx.globalCompositeOperation = 'multiply'` → overlay текста

Результат: шаблон + текст, где белые области текстового слоя прозрачны.

---

## Вкладки интерфейса

| Вкладка | Функция |
|---|---|
| **TabEditor** | Редактор одного студента + скачивание PDF с шаблоном |
| **TabGenerate** | Генерация одного PDF (без шаблона / с шаблоном) |
| **TabGenerateAll** | Пакетная генерация всех студентов → ZIP |
| **TabPreview** | Предпросмотр аттестата в браузере |

---

## Важные технические детали

### Проблема смещения html2canvas (+2mm для PDF)
html2canvas рендерит глифы Arial примерно на 2мм ниже, чем браузер.  
Решение: в PDF-режиме (`noTemplate=true`) все Y-координаты сдвигаются на +2mm вверх.  
Это НЕ влияет на предпросмотр браузера.

### Создание off-screen DOM для PDF
Используется `createRoot` на временном `div` (не `display:none`, иначе html2canvas не работает):
```js
const container = document.createElement('div')
container.style.cssText = `position:fixed;left:-9999px;top:0;z-index:-1;width:${PAGE_W}pt;`
document.body.appendChild(container)
const root = createRoot(container)
// ... render, capture, unmount, remove
```

### Шаблоны
Размер: **3508 × 2480 px** (A4 @ 300 DPI, landscape).  
Путь в браузере: `/data/template_kz.jpg` и т.д. (из `public/data/`).

---

## Что было сделано в этой сессии

1. **Исправлено смещение +2mm в PDF** — добавлен параметр `forPdf` в `getPage1Layout`, и `pdfShift = 2mm` для строк оценок. В предпросмотре смещения нет.

2. **Тонкая настройка позиций колонок оценок (RU)**:
   - Лист 1 левая: yStart `-3.5mm`
   - Лист 1 правая: yStart `-1mm`
   - Лист 2 левая: yStart `+0.5mm`
   - Лист 2 правая: yStart `+1mm`

3. **Граница переноса yLimit** поднята на `+2mm` для Листа 1 (обе колонки) в обоих языках — последний элемент больше не накладывается на нижнюю линию шаблона.

4. **Порог переноса заголовков модулей** увеличен с 65 до **75 символов**.

5. **Лист 2 сдвинут на 1мм вправо** (обе колонки, оба языка).

6. **Колонка традиционного оценивания на Листе 2** сдвинута на 1мм влево.

7. **Колонка предмета на Листе 1** сдвинута на 1мм влево (через `subjectOffX`).

8. **Удалены все файлы Streamlit** — остался только React-проект.

9. **Исправлен launch.json** — указан абсолютный путь к npm и cwd.
