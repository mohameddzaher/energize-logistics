/**
 * Page catalogue: the smallest unit of permissions.
 * Section access (none/view/edit) guards the API; page access decides which screens open within it. Generated from the sidebar (scripts/genPageCatalog.js); the endpoint map is generated from code (scripts/genPageApis) and enforced by middleware/pageGate.
 */
const { pages } = require('./pages.json');

const PAGES = pages;
const PAGE_KEYS = PAGES.map((p) => p.key);
const KEY_SET = new Set(PAGE_KEYS);

const byPage = new Map(PAGES.map((p) => [p.key, p]));
const getPage = (key) => byPage.get(key) || null;
const isPage = (key) => KEY_SET.has(key);

/** Pages of one section, in sidebar order. */
const pagesOfSection = (sectionKey) => PAGES.filter((p) => p.section === sectionKey);

/** Sections as the catalogue knows them, including unmanaged ones (Main, Admin, Portal). */
const PAGE_SECTIONS = [...new Set(PAGES.map((p) => p.section))];

/** Self-service pages show the user's own data, not a section. They are open to every internal role (isInternal) unless explicitly unticked, so a custom role that inherits nothing still reaches them. */
const PERSONAL_SECTIONS = new Set(['Self Service']);

module.exports = {
  PAGES, PAGE_KEYS, getPage, isPage, pagesOfSection, PAGE_SECTIONS, PERSONAL_SECTIONS,
};
