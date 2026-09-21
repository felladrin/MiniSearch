// Repairs flagged package copies inside the shipped global npm tree.
//
// npm pins its dependency tree exactly, so `npm install -g npm@latest`
// cannot lift bundled copies off flagged versions. The patched releases are
// installed into the /tmp/overlay scratch project by the Dockerfile (the
// only place the versions appear), and this script replaces every flagged
// copy under /usr/local/lib/node_modules with the scratch copy - using
// real Node resolution semantics, because the bundle deliberately keeps
// several majors of the same package alive in nested scopes (for example
// minipass 3.x under minipass-pipeline, 7.x at the top).
//
// After the repair it re-walks the live tree: every package's own
// dependency declarations must resolve to copies that satisfy them, and
// no same-major copy of a target package may remain below the patched
// release. Any violation fails the build.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = "/usr/local/lib/node_modules";
const SCRATCH = "/tmp/overlay/node_modules";
const TARGETS = ["tar", "brace-expansion", "ip-address", "undici"];

let semver;
try {
  semver = require(path.join(ROOT, "npm/node_modules/semver"));
} catch {
  console.error("Cannot load semver from the npm bundle; repair aborted.");
  process.exit(1);
}

const readPkg = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const pkgAt = (dir) => {
  const f = path.join(dir, "package.json");
  return fs.existsSync(f) ? readPkg(f) : null;
};
const scratchPkg = (name) => readPkg(path.join(SCRATCH, name, "package.json"));
const scratchVersion = (name) => scratchPkg(name).version;

// All package dirs under container dirs laid out like a node_modules:
// scoped and plain packages, recursing into every nested node_modules.
function collectPackageDirs(containers, acc = []) {
  for (const cont of containers) {
    if (!fs.existsSync(cont)) continue;
    const pkgs = [];
    for (const entry of fs.readdirSync(cont, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(cont, entry.name);
      if (entry.name.startsWith("@")) {
        for (const s of fs.readdirSync(full, { withFileTypes: true })) {
          const sf = path.join(full, s.name);
          if (s.isDirectory() && fs.existsSync(path.join(sf, "package.json"))) {
            pkgs.push(sf);
          }
        }
      } else if (fs.existsSync(path.join(full, "package.json"))) {
        pkgs.push(full);
      }
    }
    acc.push(...pkgs);
    collectPackageDirs(
      pkgs.map((p) => path.join(p, "node_modules")),
      acc,
    );
  }
  return acc;
}

// What `require(dep)` from inside startDir actually resolves to: walk the
// ancestors of startDir checking each one's node_modules child.
function resolveCopy(startDir, dep) {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", dep);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const replaceWith = (dir, scratchName) => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(SCRATCH, scratchName), dir, { recursive: true });
};

// Phase 1: replace copies of each target that sit below the patched release.
const replaced = [];
for (const target of TARGETS) {
  const wanted = scratchVersion(target);
  const copies = collectPackageDirs([ROOT]).filter(
    (d) => pkgAt(d) && pkgAt(d).name === target,
  );
  if (copies.length === 0) {
    console.log(`target absent from the tree, nothing to repair: ${target}`);
    continue;
  }
  for (const dir of copies) {
    const current = pkgAt(dir).version;
    if (!semver.lt(current, wanted)) {
      console.log(`${target}@${current} already at or above ${wanted}, kept`);
      continue;
    }
    replaceWith(dir, target);
    replaced.push({ dir, name: target, from: current, to: wanted });
    console.log(`repaired ${target} ${current} -> ${wanted} at ${dir}`);
  }
}

// Phase 2: closure. Every dependency the replaced code newly needs must be
// resolvable from where the replaced copy lives: where the walked copy is
// missing, copy it in from the scratch install; where it fails the new
// range, bump it the same way. Loop until no further changes.
const queue = replaced.map((r) => r.dir);
let changes = queue.length;
while (queue.length > 0) {
  const dir = queue.shift();
  const pkg = pkgAt(dir);
  for (const [dep, range] of Object.entries(pkg.dependencies || {})) {
    const copy = resolveCopy(dir, dep);
    if (!copy) {
      const host = path.dirname(dir); // the node_modules that contains `dir`
      const target = path.join(host, dep);
      if (!fs.existsSync(path.join(SCRATCH, dep, "package.json"))) {
        console.error(
          `Missing ${dep} required by ${pkg.name}, not in overlay: fail.`,
        );
        process.exit(1);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(SCRATCH, dep), target, { recursive: true });
      console.log(`added ${dep}@${scratchVersion(dep)} at ${target}`);
      queue.push(target);
      changes += 1;
      continue;
    }
    const current = pkgAt(copy).version;
    if (semver.satisfies(current, range)) continue;
    if (!fs.existsSync(path.join(SCRATCH, dep, "package.json"))) {
      console.error(
        `Cannot bump ${dep} (not in overlay) for ${pkg.name}@${range}: fail.`,
      );
      process.exit(1);
    }
    const wanted = scratchVersion(dep);
    if (!semver.lt(current, wanted)) {
      console.error(
        `${copy}@${current} fails ${pkg.name}'s ${range} but is not below the ` +
          `overlay version ${wanted}; refusing to guess.`,
      );
      process.exit(1);
    }
    replaceWith(copy, dep);
    console.log(`bumped ${dep} ${current} -> ${wanted} at ${copy}`);
    queue.push(copy);
    changes += 1;
  }
}

// Phase 3: full resolution validation over the final live tree. Every
// package's own dependency and optionalDependency declarations must
// resolve to a copy that satisfies the declared range. (peerDependencies
// are skipped: the scratch install resolved and provided what the replaced
// packages need; untouched packages kept the tree they were installed for.)
let unsatisfied = 0;
for (const dir of collectPackageDirs([ROOT])) {
  const pkg = pkgAt(dir);
  if (!pkg) continue;
  for (const group of ["dependencies", "optionalDependencies"]) {
    for (const [dep, range] of Object.entries(pkg[group] || {})) {
      const copy = resolveCopy(dir, dep);
      if (!copy) {
        console.error(
          `RESOLVE FAILED: ${pkg.name}@${pkg.version} -> ${dep}@${range} missing`,
        );
        unsatisfied += 1;
        continue;
      }
      if (!semver.satisfies(pkgAt(copy).version, range)) {
        console.error(
          `RANGE FAILED: ${pkg.name}@${pkg.version} declares ${dep}@${range}, ` +
            `resolved copy is ${pkgAt(copy).version}`,
        );
        unsatisfied += 1;
      }
    }
  }
}
if (unsatisfied > 0) {
  console.error(`Refusing to ship: ${unsatisfied} unsatisfied declaration(s).`);
  process.exit(1);
}

// Phase 4: the target invariant itself. No copy of a target package in the
// same major line as the patched release may remain below it. Different
// majors (e.g. a legitimately old nested brace-expansion 1.x serving a
// nested minimatch 3) are out of this repair's claim.
let stale = 0;
for (const target of TARGETS) {
  const wanted = scratchVersion(target);
  for (const dir of collectPackageDirs([ROOT])) {
    const pkg = pkgAt(dir);
    if (!pkg || pkg.name !== target) continue;
    if (
      semver.major(pkg.version) === semver.major(wanted) &&
      !semver.gte(pkg.version, wanted)
    ) {
      console.error(`STALE: ${target}@${pkg.version} at ${dir} (< ${wanted})`);
      stale += 1;
    }
  }
}
if (stale > 0) {
  console.error(
    `Invariant broken: ${stale} stale same-major copy(ies) remain.`,
  );
  process.exit(1);
}

console.log(
  `npm bundle repair complete: ${replaced.length} replaced, ` +
    `${changes - replaced.length} closure changes, tree resolves clean.`,
);
