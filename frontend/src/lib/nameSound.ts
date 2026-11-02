/** Matches a name across scripts: accounts are mostly in English and people search in Arabic, so an Arabic spelling of Eslam Eldesoky has to find "Eslam Eldesoky". Both sides reduce to the same consonant skeleton. Mirrored in mobile/lib/ui/name_sound.dart; keep the two in step. */
const ARABIC: Record<string, string> = {
  ب: 'b', ت: 't', ث: 's', ج: 'g', ح: 'h', خ: 'h', د: 'd', ذ: 'd', ر: 'r', ز: 'z', س: 's', ش: 's', ص: 's',
  ض: 'd', ط: 't', ظ: 'z', غ: 'g', ف: 'f', ق: 'k', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'h',
};

const consonants = (word: string): string => {
  const out = /[؀-ۿ]/.test(word)
    ? [...word].map((c) => ARABIC[c] || '').join('')
    : word.toLowerCase()
      .replace(/sh/g, 's').replace(/kh/g, 'h').replace(/gh/g, 'g').replace(/dh/g, 'd').replace(/th/g, 't')
      .replace(/ck/g, 'k').replace(/x/g, 'ks').replace(/[qc]/g, 'k').replace(/j/g, 'g').replace(/p/g, 'b').replace(/v/g, 'f')
      .replace(/[^a-z]|[aeiouyw]/g, '');
  return out.replace(/(.)\1+/g, '$1');
};

// The article drops only when a real name is left: the Arabic form of Desoky matches Desoky, but the Arabic Aleen keeps its article.
const skeleton = (word: string): string => {
  const bare = consonants(word.replace(/^(ال|al|el)/i, ''));
  return bare.length >= 2 ? bare : consonants(word);
};

const skeletons = (text: string) => text.split(/\s+/).map(skeleton).filter(Boolean);

/** True when every typed word starts a word of `name`, whatever script each is in. */
export function soundsLike(name: string, typed: string): boolean {
  const wanted = skeletons(typed);
  if (!wanted.length || wanted.some((w) => w.length < 2)) return false;
  const have = skeletons(name);
  return wanted.every((w) => have.some((h) => h.startsWith(w)));
}
