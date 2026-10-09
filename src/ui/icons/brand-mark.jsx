// Знак Уголка (SEO-BRAND-TZ.md, шаг 3) — не иконка интерфейса, другая
// категория: нужен viewBox 0 0 32 32 и fill-rule="evenodd" на самом <path>
// (вырез сердца), чего общий Icon (icon.jsx, Phosphor-конвенция 256 viewBox
// без fill-rule) не поддерживает — своя, отдельная обвязка. Путь скопирован
// как есть из PROCESS-DOCS/SEO/ugolok-brand/brand/ugolok-mark-mono.svg, не
// перерисован (запрет 1 ТЗ). Цвет — через currentColor, задаётся снаружи
// CSS-токеном акцента.
export default function BrandMark(props) {
	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
			<path
				fill="currentColor"
				fill-rule="evenodd"
				d="M4 26V11a6 6 0 0 1 6-6h12a6 6 0 0 1 6 6v9a6 6 0 0 1-6 6ZM11.5 22.6 7.78 18.9A2.76 2.76 0 0 1 11.5 15.18a2.76 2.76 0 0 1 3.72 3.72Z"
			/>
		</svg>
	);
}
