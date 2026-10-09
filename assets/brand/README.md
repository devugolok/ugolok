# Исходники бренда (SEO-BRAND-TZ.md)

Знак Уголка (облачко с одним острым углом и сердцем-вырезом) — исходники и собранные из них иконки для всех площадок. Не перерисовывать и не пересобирать руками: при изменении знака шаг один — поправить `brand/ugolok-mark.svg`/`ugolok-mark-mono.svg`, затем заново прогнать `src/build.mjs`.

| Папка | Что внутри | Куда идёт |
|---|---|---|
| `brand/` | Исходные SVG знака (цветной и монохромный), app-icon 1024, og-image.svg, отложенный блок `schema-software-application.LATER.jsonld` (см. запрет 4 в ТЗ — пока не используется) | Хранится здесь как есть, веб-иконки из `web/`-части сборки уже разложены в `public/` корня сайта |
| `android/res/` | Адаптивная иконка (foreground/monochrome/background), mipmap по плотностям, `store-icon-512.png` для листинга в сторе | Разложено в `native/mobile/android/app/src/main/res/` (store-icon-512.png — только для ручной загрузки в листинг, не часть сборки) |
| `desktop/` | `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, `icon.png` | Разложено в `native/desktop/src-tauri/icons/` (список файлов, которые реально использует сборка — `tauri.conf.json`'s `bundle.icon`) |
| `src/build.mjs` | Скрипт, которым все иконки собраны из исходного SVG | Хранится рядом с `brand/`, источник правды при пересборке |

Полное ТЗ и список выполненных шагов — `PROCESS-DOCS/SEO/SEO-BRAND-TZ.md`.
