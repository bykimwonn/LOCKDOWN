/**
 * Regression tests for patches/*.patch — patch-package parse failures.
 *
 * These exist because an EAS build died during `npm install --include=dev` with:
 *
 *   **ERROR** Failed to apply patch for package expo-notifications
 *     This happened because the patch file
 *     patches/expo-notifications+0.29.14.patch could not be parsed.
 *
 * Cause: the hunk header claimed `@@ -50,8 +50,9 @@`, but the hunk body actually
 * held 7 original lines (4 context + 3 deletion) and 8 patched lines (4 context +
 * 4 insertion). patch-package runs an integrity check over those counts and throws
 * "hunk header integrity check failed", which surfaces as the opaque "could not be
 * parsed" message above. The fix was one pair of digits: `@@ -50,7 +50,8 @@`.
 *
 * Why this deserves a test rather than just a fix: patch-package runs from
 * `postinstall`, so a malformed hunk header is invisible locally (deps are already
 * installed) and only detonates on the build machine — after a full dependency
 * install, burning an EAS build to discover a one-character typo. Hand-editing a
 * hunk header is easy to get wrong, so these tests run patch-package's own parser
 * over every file in patches/ and independently re-check the arithmetic to produce
 * an actionable message instead of "could not be parsed".
 */
const fs = require('fs');
const path = require('path');

// patch-package's real parser and filename decoder — the exact code paths that
// `postinstall` uses. Both are dependency-light CommonJS in dist/.
const { parsePatchFile } = require('patch-package/dist/patch/parse.js');
const {
  getPackageDetailsFromPatchFilename,
} = require('patch-package/dist/PackageDetails.js');

const PATCHES_DIR = path.join(__dirname, '..', 'patches');
const LOCKFILE = path.join(__dirname, '..', 'package-lock.json');

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const FILE_HEADER =
  /^(diff --git |index |new file mode|deleted file mode|similarity index|rename from|rename to|old mode|new mode|--- |\+\+\+ )/;

/**
 * Self-contained scan of unified-diff hunks and their real line counts.
 *
 * Deliberately does NOT go through patch-package's parser: when a hunk header is
 * wrong that parser throws a bare "hunk header integrity check failed" before
 * anything can be inspected, so reusing it here would make this check a duplicate
 * of the parse test above instead of an explanation of it. The parse test stays
 * the authoritative one — this exists to say *which* hunk is wrong and by how much.
 *
 * A hunk stops counting once its declared line counts are satisfied, so the
 * `--- `/`+++ ` file headers of a following file are never mistaken for
 * deletions/insertions.
 */
function scanHunks(rawDiff) {
  // Drop only the final newline, so the split can't leave a trailing '' that
  // would be miscounted as a blank context line.
  const lines = rawDiff.replace(/\n$/, '').split('\n');
  const hunks = [];
  let current = null;

  const isFull = (h) =>
    h.original >= h.declaredOriginal && h.patched >= h.declaredPatched;

  for (const line of lines) {
    const header = line.match(HUNK_HEADER);
    if (header) {
      current = {
        header: line.trim(),
        start: Number(header[1]),
        // An omitted length means 1, per the unified-diff spec.
        declaredOriginal: header[2] === undefined ? 1 : Number(header[2]),
        declaredPatched: header[4] === undefined ? 1 : Number(header[4]),
        original: 0,
        patched: 0,
      };
      hunks.push(current);
      continue;
    }

    // `diff --git` is unambiguous: inside a hunk every body line carries a
    // leading '-', '+' or ' ', so a bare one can only start a new file section.
    if (line.startsWith('diff --git ')) {
      current = null;
      continue;
    }

    if (!current || isFull(current)) continue;

    // "\ No newline at end of file" is a marker, not a line.
    if (line.startsWith('\\')) continue;

    if (FILE_HEADER.test(line)) {
      current = null;
      continue;
    }

    if (line.startsWith('-')) {
      current.original += 1;
    } else if (line.startsWith('+')) {
      current.patched += 1;
    } else if (line.startsWith(' ') || line === '') {
      // Context lines are present on both sides. A bare '' is a blank context
      // line whose single leading space was stripped by an editor or a
      // trailing-whitespace cleanup — safe to treat as context because the one
      // trailing newline of the file was already removed above, so no stray ''
      // can appear at the end of the split.
      current.original += 1;
      current.patched += 1;
    } else {
      // Unrecognised body line. Stop rather than guess and mis-report counts.
      current = null;
    }
  }

  return hunks;
}

/** Every patch file patch-package would pick up, sorted for stable output. */
function patchFiles() {
  if (!fs.existsSync(PATCHES_DIR)) return [];
  return fs
    .readdirSync(PATCHES_DIR)
    .filter((f) => f.endsWith('.patch'))
    .sort();
}

const files = patchFiles();
const lock = JSON.parse(fs.readFileSync(LOCKFILE, 'utf8'));

describe('patches/ directory', () => {
  it('exists and ships at least the expo-notifications smart-cast fix', () => {
    expect(files).toContain('expo-notifications+0.29.14.patch');
  });

  it('contains only files patch-package can decode into a package + version', () => {
    // A stray README or a mis-named file here is silently ignored by
    // patch-package, so an un-decodable .patch means the fix never applies.
    const undecodable = files.filter(
      (f) => getPackageDetailsFromPatchFilename(f) === null,
    );
    expect(undecodable).toEqual([]);
  });
});

describe.each(files)('patches/%s', (filename) => {
  const filePath = path.join(PATCHES_DIR, filename);
  const contents = () => fs.readFileSync(filePath, 'utf8');

  it('parses with patch-package (the postinstall code path)', () => {
    // This is the assertion that would have caught the EAS failure. On a bad
    // hunk header it throws "hunk header integrity check failed", which
    // patch-package reports to npm as an unparseable patch file.
    expect(() => parsePatchFile(contents())).not.toThrow();
  });

  it('has hunk headers whose line counts match the hunk body', () => {
    // Independent re-check of the arithmetic that broke the EAS build, with a
    // message naming the offending hunk instead of "could not be parsed".
    const hunks = scanHunks(contents());
    expect(hunks.length).toBeGreaterThan(0);

    const bad = [];
    for (const h of hunks) {
      if (h.original !== h.declaredOriginal) {
        bad.push(
          `hunk at line ${h.start}: header '${h.header}' declares ${h.declaredOriginal} ` +
            `original line(s) but the body has ${h.original} (context + '-'). ` +
            `Expected '@@ -${h.start},${h.original} …'`,
        );
      }
      if (h.patched !== h.declaredPatched) {
        bad.push(
          `hunk at line ${h.start}: header '${h.header}' declares ${h.declaredPatched} ` +
            `patched line(s) but the body has ${h.patched} (context + '+'). ` +
            `Expected '… +${h.start},${h.patched} @@'`,
        );
      }
    }

    expect(bad).toEqual([]);
  });

  it('ends with a newline and uses no CRLF line endings', () => {
    // CRLF creeps in when a patch is edited on Windows (see DO_NOT_OVERWRITE.md —
    // this repo is worked on from a Windows path) and breaks context matching.
    const raw = contents();
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).not.toMatch(/\r/);
  });

  it('targets a package version that package-lock.json actually resolves', () => {
    // Guards the other silent failure: bump the dependency and the patch filename
    // keeps the old version, so patch-package skips or mis-applies it while the
    // bug it fixed quietly comes back.
    const details = getPackageDetailsFromPatchFilename(filename);
    const entry = lock.packages[details.path];

    expect(entry).toBeDefined();
    expect({
      package: details.name,
      lockedVersion: entry && entry.version,
      patchFilenameVersion: details.version,
    }).toEqual({
      package: details.name,
      lockedVersion: details.version,
      patchFilenameVersion: details.version,
    });
  });
});

describe('postinstall wiring', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
  );

  it('runs patch-package from postinstall', () => {
    // Without this hook nothing in patches/ is applied on a fresh install,
    // including on the EAS build machine.
    expect(pkg.scripts.postinstall).toMatch(/patch-package/);
  });

  it('lists patch-package as a devDependency pinned in the lockfile', () => {
    // EAS installs with --include=dev. If patch-package were missing from the
    // lockfile, `npm ci` would refuse to run at all ("package.json and
    // package-lock.json are not in sync") — it was missing once already.
    expect(pkg.devDependencies['patch-package']).toBeDefined();

    const locked = lock.packages['node_modules/patch-package'];
    expect(locked).toBeDefined();
    expect(lock.packages[''].devDependencies['patch-package']).toBe(
      pkg.devDependencies['patch-package'],
    );
  });
});
