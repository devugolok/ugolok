import { useDetailsMenu } from "../hooks/use-details-menu.js";
import IconDotsVertical from "../icons/dots-vertical.jsx";

// Меню "ещё действия" на нативном <details> (VISUAL.md v2, Claude Opus) —
// без JS-библиотек всплывающих меню: клик/Enter/Space открывают/закрывают
// сами по себе (нативная семантика <details>/<summary>), доступно с
// клавиатуры "из коробки". Закрытие по клику вне/по пункту/по Escape —
// useDetailsMenu (тот же хук использует AddToGroupControl, contacts.jsx,
// для чекбокс-варианта меню).
// closeOn — селектор пунктов, клик по которым закрывает меню (по умолчанию любые кнопки/ссылки). Нужен, чтобы пункт
// мог открыть ВТОРОЙ уровень внутри того же меню, не закрывая его (напр. `button:not([data-keep-open])`).
export default function ActionsMenu({ label, children, popClass, icon: SummaryIcon = IconDotsVertical, summaryClass = "icon-btn", closeOn, onClose }) {
	const { ref, handleMenuClick } = useDetailsMenu(closeOn);

	return (
		<details class="menu" ref={ref} onClick={handleMenuClick} onToggle={(e) => !e.currentTarget.open && onClose?.()}>
			<summary class={summaryClass} aria-label={label}>
				<SummaryIcon />
			</summary>
			<div class={`menu-pop stack${popClass ? ` ${popClass}` : ""}`} style={{ "--gap": "2px" }}>
				{children}
			</div>
		</details>
	);
}
