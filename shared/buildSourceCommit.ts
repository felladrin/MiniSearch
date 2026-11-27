/**
 * Which commit a build should report as its own.
 *
 * A build from the source repository reports its own git commit. A Hugging Face
 * Space is built from a copy of the repository made by the deploy workflow, so
 * its git commit belongs to the Space's own history and says nothing about the
 * code that is running; the workflow writes the source commit into
 * `SOURCE_COMMIT_FILE` next to the copy, and that is what a build reports then.
 */

/** The file the deploy workflow writes the source commit into, named by the workflow step that creates it. */
export const SOURCE_COMMIT_FILE = ".source-commit";

/**
 * A commit hash has to be at least this long to be believed. Git's own short
 * hashes start at 7 and grow until they are unique in the repository.
 */
const MIN_COMMIT_LENGTH = 7;

const HEX = /^[0-9a-f]+$/i;

/**
 * The commit to report: the synced source commit when the build was made from a
 * synced copy, otherwise the build's own git hash, otherwise empty. Neither is
 * shortened, because git already picks a length that is unique in the
 * repository and the deploy workflow writes the same length.
 *
 * A synced file that holds something other than a commit is an error rather
 * than a fallback. On a Space the git hash is the copy's own commit, which is
 * the wrong answer this module exists to avoid, so a build that could not read
 * the file has to say so instead of quietly reporting it.
 */
export function resolveSourceCommitHash(input: {
  syncedCommit?: string | null;
  gitHash?: string | null;
}): string {
  const synced = input.syncedCommit?.trim().toLowerCase() ?? "";
  if (synced.length > 0) {
    if (!HEX.test(synced) || synced.length < MIN_COMMIT_LENGTH) {
      throw new Error(
        `${SOURCE_COMMIT_FILE} holds "${synced}", which is not a commit hash`,
      );
    }

    return synced;
  }

  const git = input.gitHash?.trim().toLowerCase() ?? "";
  if (HEX.test(git) && git.length >= MIN_COMMIT_LENGTH) {
    return git;
  }

  return "";
}
