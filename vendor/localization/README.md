# Third-party localization sources

The original Simplified Chinese translation data in this directory is distributed under the MIT licenses included in each source folder. It was adapted to Traditional Chinese with OpenCC (Taiwan phrases), filtered to literal phrases, and used to generate `src/localization/*.json`. Generated text may require correction and does not cover every CLI version.

- `claude/`: [taekchef/claude-code-zh-cn](https://github.com/taekchef/claude-code-zh-cn), commit `54551cd2423fb83488e29866064574805ac55d7c`, copyright 2026 taekchef.
- `codex/`: [taekchef/codex-code-zh-cn](https://github.com/taekchef/codex-code-zh-cn), commit `d5c554a860ed22483a49c820283439c9eb23746e`, copyright 2026 taekchef.
- Conversion uses [opencc-js](https://github.com/nk2028/opencc-js). Run `node scripts/generate-traditional-ui.mjs` after `npm ci` to regenerate the derived tables.

These projects are independent of Anthropic and OpenAI. The original CLI binaries and their installation paths are not patched by this project.
