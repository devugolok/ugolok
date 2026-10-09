import IconSmiley from "../icons/smiley.jsx";
import IconSmileyWink from "../icons/smiley-wink.jsx";
import IconSmileyMeh from "../icons/smiley-meh.jsx";
import IconSmileyNervous from "../icons/smiley-nervous.jsx";
import IconSmileySad from "../icons/smiley-sad.jsx";
import IconSmileyAngry from "../icons/smiley-angry.jsx";
import IconSmileyMelting from "../icons/smiley-melting.jsx";
import IconSmileyXEyes from "../icons/smiley-x-eyes.jsx";
import IconHeart from "../icons/heart.jsx";
import IconHandHeart from "../icons/hand-heart.jsx";
import IconThumbsUp from "../icons/thumbs-up.jsx";
import IconThumbsDown from "../icons/thumbs-down.jsx";
import IconHandPeace from "../icons/hand-peace.jsx";
import IconHandFist from "../icons/hand-fist.jsx";
import IconHandsClapping from "../icons/hands-clapping.jsx";
import IconHandsPraying from "../icons/hands-praying.jsx";
import IconHandshake from "../icons/handshake.jsx";
import IconConfetti from "../icons/confetti.jsx";

// Бывший набор «смайлов» (Phosphor): id совпадают с id набора emoji (domain/content/emoji-pack.js). Оставлен как
// второй вариант оформления — переключается одной константой ACTIVE_EMOJI_PACK в emoji-glyph.jsx; для id, которых
// здесь нет (появились с переходом на emoji), показывается юникод-эмодзи.
export const PHOSPHOR_EMOJI_ICONS = {
	smiley: IconSmiley,
	"smiley-wink": IconSmileyWink,
	"smiley-meh": IconSmileyMeh,
	"smiley-nervous": IconSmileyNervous,
	"smiley-sad": IconSmileySad,
	"smiley-angry": IconSmileyAngry,
	"smiley-melting": IconSmileyMelting,
	"smiley-x-eyes": IconSmileyXEyes,
	heart: IconHeart,
	"hand-heart": IconHandHeart,
	"thumbs-up": IconThumbsUp,
	"thumbs-down": IconThumbsDown,
	"hand-peace": IconHandPeace,
	"hand-fist": IconHandFist,
	"hands-clapping": IconHandsClapping,
	"hands-praying": IconHandsPraying,
	handshake: IconHandshake,
	confetti: IconConfetti,
};
