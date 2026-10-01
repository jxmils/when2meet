interface ImportMetaEnv {
  readonly WXT_GOOGLE_BROKER_URL?: string;
  readonly WXT_MICROSOFT_CLIENT_ID?: string;
}

/** True in builds made with W2M_DEV_HOSTS=1 (also runs on localhost, for the mock server). */
declare const __W2M_DEV_HOSTS__: boolean;
