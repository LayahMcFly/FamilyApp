/*
 * config.js — the ONLY file you normally need to edit.
 *
 * Everything here is PUBLIC client configuration. It is safe to commit to GitHub.
 * NEVER put an Appwrite API key, server key, or password in this file.
 *
 * Values you MUST replace are marked  <<< REPLACE.
 */
window.FAMILY_CONFIG = {
  appName: "Family Circle",

  // <<< REPLACE: copy the "API Endpoint" from Appwrite Console > your project > Settings.
  // It looks like https://<REGION>.cloud.appwrite.io/v1  (keep the /v1 at the end).
  endpoint: "https://nyc.cloud.appwrite.io/v1",

  // <<< REPLACE: copy the "Project ID" from Appwrite Console > your project > Settings.
  projectId: "6aef6a03002636be44c2",

  // <<< FILL IN LATER (Setup Guide step 6): the ID of your family Team.
  // Leave as "" until you create the Team. While it is empty, the first signed-in
  // person sees a one-time "Create the family team" screen.
  teamId: "6aef70c8002b376dccce",

  // The IDs below match the Setup Guide. If you create your database, tables and
  // bucket with these exact IDs you do not need to change anything here.
  databaseId: "family",
  tables: {
    profiles: "profiles",
    posts: "posts",
    comments: "comments",
    reactions: "reactions",
    bookmarks: "bookmarks"
  },
  bucketId: "family-media",

  // App-side limits. These protect your free plan, but they run in the browser,
  // so they are a convenience, not security. The SERVER-side limits are the bucket
  // settings (maximum file size + allowed extensions) from the Setup Guide.
  limits: {
    imageMaxEdge: 1600,      // photos are shrunk so the longest side is at most this many pixels
    imageQuality: 0.82,      // JPEG quality used when shrinking photos (0 to 1)
    avatarEdge: 256,         // profile pictures are shrunk to this size
    videoMaxMB: 25,          // keep this at or below the bucket "Maximum file size"
    shortMaxSeconds: 60,     // Shorts must be this long or shorter, and vertical
    bodyMax: 2000,           // max characters in a post
    commentMax: 500,         // max characters in a comment
    pageSize: 10             // posts loaded per "Load more"
  }
};
