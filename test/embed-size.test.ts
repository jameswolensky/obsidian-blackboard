import { describe, it, expect } from 'vitest';
import { parseEmbedSize, fitSavedEmbedSize } from '../src/presentation/embed-size';

describe('fitSavedEmbedSize', () => {
  it('keeps the saved size when it fits the available width', () => {
    expect(fitSavedEmbedSize(320, 240, 700)).toEqual({ width: 320, height: 240 });
  });
  it('scales down proportionally when wider than the note', () => {
    // 800 wide into 400 available -> half scale, aspect preserved
    expect(fitSavedEmbedSize(800, 600, 400)).toEqual({ width: 400, height: 300 });
  });
  it('never upscales beyond the saved size', () => {
    expect(fitSavedEmbedSize(200, 100, 2000)).toEqual({ width: 200, height: 100 });
  });
  it('returns null for a degenerate saved size', () => {
    expect(fitSavedEmbedSize(0, 0, 500)).toBeNull();
  });
});


describe('parseEmbedSize', () => {
  it('parses WxH', () => {
    expect(parseEmbedSize('640x480')).toEqual({ width: '640px', height: '480px' });
  });
  it('parses width-only', () => {
    expect(parseEmbedSize('300')).toEqual({ width: '300px', height: null });
  });
  it('parses percent width', () => {
    expect(parseEmbedSize('100%')).toEqual({ width: '100%', height: null });
  });
  it('parses percentxheight', () => {
    expect(parseEmbedSize('100%x400')).toEqual({ width: '100%', height: '400px' });
  });
  it('returns null for empty/garbage', () => {
    expect(parseEmbedSize('')).toBeNull();
    expect(parseEmbedSize('abc')).toBeNull();
  });
  it('returns null for null/undefined input', () => {
    expect(parseEmbedSize(null)).toBeNull();
    expect(parseEmbedSize(undefined)).toBeNull();
  });
  it('returns null for a zero width', () => {
    expect(parseEmbedSize('0')).toBeNull();
    expect(parseEmbedSize('0x0')).toBeNull();
  });
  it('drops a zero height but keeps the width', () => {
    expect(parseEmbedSize('640x0')).toEqual({ width: '640px', height: null });
  });
});
