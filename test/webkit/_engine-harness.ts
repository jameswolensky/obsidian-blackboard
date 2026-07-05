// Harness entry: bundle the REAL DrawingEngine (and nothing Obsidian-specific) so a browser
// page can mount it and we can screenshot actual rendered transform outcomes in iPad WebKit.
// Built with: npx esbuild test/webkit/_engine-harness.ts --bundle --format=iife --global-name=BB --outfile=test/webkit/_engine-harness.js
import { DrawingEngine } from '../../src/infrastructure/canvas-renderer';
export { DrawingEngine };
