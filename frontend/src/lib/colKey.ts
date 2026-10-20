/**
 * القيمةُ كما تُقرأ — لقوائم فلاتر الأعمدة.
 *
 * قيمتان لا يفرّقهما إلّا الفراغ («الدمام» و«الدمام » و«الدمام» بمسافةٍ صلبة)
 * تُقرآن على الشاشة شيئًا واحدًا، فهما في القائمة سطرٌ واحد. وما يُرى مختلفًا
 * («أحمد»/«احمد»، «١٢»/«12») يبقى مختلفًا — كما في إكسل.
 *
 * النظيرُ في الخادم: backend/src/utils/colFilter.normKey — والقاعدةُ واحدة.
 */
const SPACE_RUN = new RegExp(
  '[\\s\\u00a0\\u1680\\u180e\\u2000-\\u200f\\u202a-\\u202f\\u205f\\u2060-\\u206f\\u3000\\ufeff]+',
  'g',
);

export const colKey = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v).replace(SPACE_RUN, ' ').trim();
};
