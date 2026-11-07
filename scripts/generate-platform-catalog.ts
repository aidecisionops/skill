#!/usr/bin/env bun
import { DEFAULT_PLATFORM_CATALOG_PATH, PLATFORMS_DIR, writePlatformCatalog } from "../src/index";

function main(): void {
  const outputPath = process.argv[2] ?? DEFAULT_PLATFORM_CATALOG_PATH;
  const platformsDir = process.argv[3] ?? PLATFORMS_DIR;
  const writtenPath = writePlatformCatalog(outputPath, platformsDir);
  console.log(`Wrote platform catalog: ${writtenPath}`);
}

main();
