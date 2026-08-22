const fs = require("fs");
const {
  exchangeNpssoForAccessCode,
  exchangeAccessCodeForAuthTokens,
  exchangeRefreshTokenForAuthTokens,
  getBasicPresence,
  getProfileFromAccountId,
} = require("psn-api");

const TOKENS_PATH = "/data/psn-tokens.json";

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function clearTokens() {
  try {
    fs.unlinkSync(TOKENS_PATH);
  } catch {
    // nothing to clear
  }
}

class PsnClient {
  constructor() {
    this.tokens = loadTokens();
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  get isPaired() {
    return !!this.tokens?.refreshToken;
  }

  // One-time setup: exchange the npsso cookie value for a refresh token
  // and store it. Called from the ingress setup page.
  async pairWithNpsso(npsso) {
    const accessCode = await exchangeNpssoForAccessCode(npsso.trim());
    const authorization = await exchangeAccessCodeForAuthTokens(accessCode);
    this._storeAuthorization(authorization);

    // Confirm it actually works and get a friendly account name back.
    const profile = await getProfileFromAccountId(
      { accessToken: authorization.accessToken },
      "me",
    );
    return profile;
  }

  _storeAuthorization(authorization) {
    this.accessToken = authorization.accessToken;
    this.accessTokenExpiresAt = Date.now() + authorization.expiresIn * 1000;
    this.tokens = {
      refreshToken: authorization.refreshToken,
      refreshTokenExpiresAt:
        Date.now() + authorization.refreshTokenExpiresIn * 1000,
    };
    saveTokens(this.tokens);
  }

  // Returns a valid access token, refreshing (and rotating the stored
  // refresh token) as needed. Throws if pairing is missing/dead.
  async getAccessToken() {
    if (!this.isPaired) {
      throw new Error("NOT_PAIRED");
    }

    const stillValid = this.accessToken && Date.now() < this.accessTokenExpiresAt - 60_000;
    if (stillValid) {
      return this.accessToken;
    }

    try {
      const authorization = await exchangeRefreshTokenForAuthTokens(
        this.tokens.refreshToken,
      );
      this._storeAuthorization(authorization);
      return this.accessToken;
    } catch (err) {
      // The refresh token itself is dead (expired/revoked) -- pairing
      // needs to be redone via the ingress setup page.
      clearTokens();
      this.tokens = null;
      this.accessToken = null;
      const wrapped = new Error("REAUTH_REQUIRED");
      wrapped.cause = err;
      throw wrapped;
    }
  }

  forget() {
    clearTokens();
    this.tokens = null;
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async getPresence() {
    const accessToken = await this.getAccessToken();
    return getBasicPresence({ accessToken }, "me");
  }
}

module.exports = { PsnClient };
