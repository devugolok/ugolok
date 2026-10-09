// UserCard — единственная вёрстка карточки человека в проекте.
// Компонент презентационный: ничего не знает ни про profiles.value, ни
// про i18n, ни про то, в каком экране стоит. Всё приходит пропсами —
// поэтому одна и та же карточка ложится и в ленту "Знакомств" (данные
// из discoveryProfiles), и в списки "Контактов" (данные из profiles),
// не связывая эти два источника (DISCOVERY.md, часть C).
//
// Раскладка — .ucard (custom.css, grid-template-areas). Здесь только
// зоны и модификаторы, ни одного инлайнового размера.

/**
 * @param {object}   p
 * @param {"div"|"li"} [p.as]        тег обёртки-контейнера (в <ul> — "li")
 * @param {"panel"|"row"} [p.variant] вид: самостоятельная карточка / строка списка
 * @param {boolean}  [p.accent]      тёплый угловой свет + штриховка
 * @param {string}   [p.avatarUrl]   картинка аватара; нет — буква-заглушка
 * @param {string}   p.name          отображаемое имя (или усечённый npub)
 * @param {boolean}  [p.nameIsNpub]  имя = npub: моноширинный, не жирный
 * @param {any}      [p.badge]       довесок к имени (например " [3]")
 * @param {string}   [p.bio]         строка "о себе"
 * @param {number}   [p.bioLines]    обрезать био до N строк (по умолчанию не обрезать)
 * @param {any}      [p.extra]       содержимое под био: <ul> каналов и т.п.
 * @param {any}      [p.actions]     кнопки справа (узко — под карточкой)
 * @param {any}      [p.meta]        нижняя строка: чипы групп, "в группу"
 * @param {boolean}  [p.metaInside]  meta живёт ВНУТРИ блока «аватар+имя+био», третьей
 *                                   строкой текстовой колонки (аватар держит все три).
 *                                   Кнопку внутри кнопки класть нельзя, поэтому блок —
 *                                   div, имя — отдельная кнопка, аватар/био открывают
 *                                   то же по клику мышью (клавиатуре хватает кнопки-имени)
 * @param {Function} [p.onOpen]      клик по зоне "аватар+имя+био"
 * @param {string}   [p.openLabel]   aria-label этой зоны (обязателен с onOpen)
 * @param {string}   [p.class]       довесок классов на .ucard
 */
export default function UserCard({
	as: Wrapper = "div",
	variant = "row",
	accent = false,
	avatarUrl,
	name,
	nameIsNpub = false,
	badge,
	bio,
	bioLines,
	extra,
	actions,
	meta,
	metaInside = false,
	onOpen,
	openLabel,
	class: extraClass = "",
	...rest
}) {
	const cardClass =
		"ucard ucard--" + variant + (accent ? " ucard--accent" : "") + (extraClass ? " " + extraClass : "");

	// Аватар — <figure>: это самостоятельная медиа-единица, и фото, и
	// буква-заглушка одинаково представляют человека. Заглушка
	// aria-hidden: имя рядом уже озвучено, буква — не информация.
	const avatar = (
		<figure class="ucard__avatar">
			{avatarUrl ? (
				<img src={avatarUrl} alt="" class="ucard__photo" />
			) : (
				<div
					aria-hidden="true"
					class="ucard__photo ucard__photo--empty row"
					style={{ "--align": "center", justifyContent: "center" }}
				>
					{(name || "?").trim().charAt(0).toUpperCase()}
				</div>
			)}
		</figure>
	);

	const inner = (
		<>
			{avatar}
			<span class={"ucard__name" + (nameIsNpub ? " ucard__name--npub" : "")}>
				{name}
				{badge}
			</span>
			{/* <span>, не <p>: этот блок бывает содержимым <button>, а
			    кнопка принимает только фразовое содержимое. display:block
			    даёт CSS. */}
			{bio && (
				<span
					class={"ucard__bio" + (bioLines ? " truncate" : "")}
					style={bioLines ? { "--lines": bioLines } : undefined}
				>
					{bio}
				</span>
			)}
		</>
	);

	// metaInside: без subgrid и без вложенных кнопок — простая сетка «аватар | текст».
	const richInner = (
		<>
			{avatar}
			{onOpen ? (
				<button
					type="button"
					class={"ucard__name ucard__name--btn" + (nameIsNpub ? " ucard__name--npub" : "")}
					onClick={onOpen}
					aria-label={openLabel}
				>
					{name}
					{badge}
				</button>
			) : (
				<span class={"ucard__name" + (nameIsNpub ? " ucard__name--npub" : "")}>
					{name}
					{badge}
				</span>
			)}
			{bio && (
				<span
					class={"ucard__bio" + (bioLines ? " truncate" : "")}
					style={bioLines ? { "--lines": bioLines } : undefined}
				>
					{bio}
				</span>
			)}
			<div class="ucard__meta-in">{meta}</div>
		</>
	);

	function openFromBlank(e) {
		if (e.target.closest("button, a, summary, input, label, details")) return;
		onOpen();
	}

	const rich = metaInside && meta;

	return (
		<Wrapper class="ucard-shell" {...rest}>
			<article class={cardClass}>
				{rich ? (
					<div class="ucard__who ucard__who--rich" onClick={onOpen ? openFromBlank : undefined}>
						{richInner}
					</div>
				) : onOpen ? (
					<button type="button" class="ucard__who" onClick={onOpen} aria-label={openLabel}>
						{inner}
					</button>
				) : (
					<div class="ucard__who">{inner}</div>
				)}
				{/* Зону назначает компонент, а не вызывающий экран: забыть
				    класс нельзя, и каналы никогда не разъедутся с био. */}
				{extra && <div class="ucard__extra">{extra}</div>}
				{actions && (
					<div class="ucard__actions row" style={{ "--gap": "var(--space-2xs)", "--align": "center" }}>
						{actions}
					</div>
				)}
				{meta && !rich && (
					<div class="ucard__meta row" style={{ "--gap": "var(--space-2xs)", "--align": "center" }}>
						{meta}
					</div>
				)}
			</article>
		</Wrapper>
	);
}
