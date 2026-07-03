import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal standalone server bundle under `.next/standalone/`.
  // The Docker runner copies that bundle + `.next/static` + `public` and runs
  // `node server.js`, which avoids shipping all of node_modules into the image.
  // See infra/README.md.
  output: "standalone",

  // Mark better-sqlite3 (and its native bindings) as external so Next does not
  // try to bundle it through Turbopack/webpack. The standalone build then
  // resolves it from node_modules at runtime — which is what we want, because
  // the .node binary has to match the runtime Node version.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
