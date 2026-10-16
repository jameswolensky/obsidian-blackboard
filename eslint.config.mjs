import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

// Mirrors the rules Obsidian's community-plugin review runs on source code, so CI catches
// violations before a release is submitted instead of in review. This covers only the
// eslint-checkable rules. Obsidian's separate CSS, activeDocument, attestation and behavior
// analyzers are not reproduced here.
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
