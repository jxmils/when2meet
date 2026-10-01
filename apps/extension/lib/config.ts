export const PRODUCT_NAME = 'Calendar Sync for When2meet';
export const REPO_URL = 'https://github.com/jxmils/when2meet';

export const DOCS = {
  calendarLinks: `${REPO_URL}/blob/main/docs/CALENDAR_LINKS.md`,
  itAdmins: `${REPO_URL}/blob/main/docs/IT_ADMINS.md`,
  privacy: `${REPO_URL}/blob/main/docs/PRIVACY.md`,
  issues: `${REPO_URL}/issues`,
};

export const GOOGLE_BROKER_URL = (import.meta.env.WXT_GOOGLE_BROKER_URL ?? '').replace(/\/+$/, '');
export const MICROSOFT_CLIENT_ID = import.meta.env.WXT_MICROSOFT_CLIENT_ID ?? '';

export const features = {
  google: GOOGLE_BROKER_URL !== '',
  microsoft: MICROSOFT_CLIENT_ID !== '',
};
