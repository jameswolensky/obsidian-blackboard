import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

// Mirrors the rules Obsidian's community-plugin review runs on source code, so violations
// are caught in CI before a release is submitted rather than in review. Note: this covers
// the eslint-checkable rules only — Obsidian's separate CSS, activeDocument, attestation,
// and behavior analyzers are not reproduced here.
export default tseslint.config(
  {
    ignores: [
      'main.js',
      'test/**',
      'docs/**',
      'esbuild.config.mjs',
      'version-bump.mjs',
      'eslint.config.mjs',
      'node_modules/**',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
);
