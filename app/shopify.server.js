import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  // Custom distribution: this app is for one store (greatoutdoorsindia), not
  // the public App Store. AppStore distribution would only allow installing on
  // *development* stores until the app is listed and approved — on a live store
  // it fails with "The installation link for this app is invalid".
  // This must match the Distribution setting in the Partner Dashboard.
  distribution: AppDistribution.SingleMerchant,
  isEmbeddedApp: true,

  future: {
    // REQUIRED, and must stay in step with `use_legacy_install_flow = false`
    // in shopify.app.toml.
    //
    // With this off (the library default), an embedded app runs the legacy
    // cookie-based OAuth redirect. Inside the Shopify admin iframe that cookie
    // is dropped as a cross-site cookie, so the callback fails and the admin
    // bounces around before landing on
    // `?oauth_error=same_site_cookies` — surfaced to the merchant as the
    // misleading "app can't load due to an issue with browser cookies".
    //
    // On, the app uses token exchange instead: no OAuth redirect, no cookies.
    unstable_newEmbeddedAuthStrategy: true,
  },

  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
