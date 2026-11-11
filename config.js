/*
 * config.js — public client configuration for the app (you set it once, families never touch it).
 *
 * Everything here is PUBLIC client configuration. It is safe to commit to GitHub.
 * NEVER put an Appwrite API key, server key, or password in this file.
 *
 * Values you MUST replace are marked  <<< REPLACE.
 */
window.FAMILY_CONFIG = {
  appName: "Family Circle",

  // Shown in the footer. Bump this on every update (1.0.0 -> 1.0.1 for fixes, 1.1.0 for new features).
  version: "1.46.5",

  // "Xenova/whisper-tiny.en" is about 40 MB, faster, but misses a lot. Base is the better balance.
  // "Xenova/whisper-base.en" is more accurate but about 3 times bigger and slower.
  captionModel: "Xenova/whisper-base.en",

  // The video editor works on the device. It refuses files bigger or longer than this, because the sound is held in memory while editing.
  // How much photo and video this device may keep after viewing (the oldest copies go first). Nothing in the cloud is affected.
  mediaCacheMB: 300,
  editorMaxInputMB: 300,
  editorMaxSeconds: 300,

  // One-line promise shown on the sign-in screens and in the footer. Only say what is true today.
  tagline: "A private place for your family. No ads. No subscriptions.",

  // Where feedback, bug reports and questions go (GitHub Issues on the project repo).
  feedbackUrl: "https://github.com/LayahMcFly/FamilyCircle/issues/new/choose",
  githubUrl: "https://github.com/layahmcfly",

  // <<< REPLACE: copy the "API Endpoint" from Appwrite Console > your project > Settings.
  // It looks like https://<REGION>.cloud.appwrite.io/v1  (keep the /v1 at the end).
  endpoint: "https://nyc.cloud.appwrite.io/v1",

  // <<< REPLACE: copy the "Project ID" from Appwrite Console > your project > Settings.
  projectId: "6aef6a03002636be44c2",

  // The ID of the Appwrite Function that does the trusted work (see the Setup Guide).
  // There is NO family or team ID in this file: every family creates its own Appwrite Team
  // from the website, and the app discovers each person's families at sign-in.
  functionId: "family-api",

  // Optional Photo Gifts shop (see SHOP-GUIDE.md). These are public IDs, not secrets.
  // Set shopEnabled to false, or leave the function unset, to hide the shop completely.
  shopEnabled: true,
  shopFunctionId: "shop-api",
  shopBucketId: "family-media",

  // The IDs below match the Setup Guide. If you create your database, tables and
  // bucket with these exact IDs you do not need to change anything here.
  databaseId: "family",
  tables: {
    profiles: "profiles",
    posts: "posts",
    comments: "comments",
    reactions: "reactions",
    bookmarks: "bookmarks",
    people: "people",
    suggestions: "suggestions"
  },  // (the "families" table is only used by the function, never by the browser)
  bucketId: "family-media",

  // App-side limits. These protect your free plan, but they run in the browser,
  // so they are a convenience, not security. The SERVER-side limits are the bucket
  // settings (maximum file size + allowed extensions) from the Setup Guide.
  limits: {
    imageMaxEdge: 1600,      // photos are shrunk so the longest side is at most this many pixels
    imageQuality: 0.82,      // JPEG quality used when shrinking photos (0 to 1)
    avatarEdge: 256,         // profile pictures are shrunk to this size
    videoMaxMB: 15,          // keep this at or below the bucket "Maximum file size"
    shortMaxSeconds: 60,     // Shorts must be this long or shorter, and vertical
    bodyMax: 2000,           // max characters in a post
    commentMax: 500,         // max characters in a comment
    pageSize: 10,            // posts loaded per "Load more"
    trendingShare: 0.5,      // a post trends when this share of the OTHER family members liked it
    trendingMin: 2,          // ...but never fewer than this many likes (or everyone, in a tiny family)
    trendingDays: 14         // only likes from the last this-many days count
  }
};
