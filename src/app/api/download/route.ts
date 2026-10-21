import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

/**
 * Serves the bundled project zip for download.
 *
 * The zip is created by the build script (see `scripts/build-zip.sh` or
 * the in-repo instructions in `SETUP.md`) and placed at the project root.
 * It excludes:
 *
 *   - node_modules, target, .next, .git
 *   - logs, screenshots, .env.local
 *   - .output (extension build artifacts)
 *
 * SECURITY: never serve any file other than `keytap-project.zip` from
 * this route. The filename is hard-coded; the request has no influence
 * over which file is read.
 *
 * @returns application/zip with Content-Disposition: attachment
 */
export async function GET() {
  try {
    const zipPath = join(process.cwd(), "keytap-project.zip");
    const fileBuffer = await readFile(zipPath);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="keytap-project.zip"',
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Could not read project zip",
        detail: message,
        hint: "Did you run the build script that produces keytap-project.zip? See SETUP.md.",
      },
      { status: 500 },
    );
  }
}
