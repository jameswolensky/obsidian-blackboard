import { describe, it, expect } from 'vitest';
import { ToolManager } from '../src/domain/tool-manager';

describe('ToolManager', () => {
  it('default tool is pen', () => {
    const tm = new ToolManager();
    expect(tm.activeTool).toBe('pen');
  });

  it('setTool changes active tool', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');
    expect(tm.activeTool).toBe('highlighter');
  });

  it('activeColor returns pen color when pen active', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    expect(tm.activeColor).toBe('#ffffff');
  });

  it('activeColor returns highlighter color when highlighter active', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');
    expect(tm.activeColor).toBe('#FFFF00');
  });

  it('setColor on pen updates pen color', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    tm.setColor('#FF0000');
    expect(tm.activeColor).toBe('#FF0000');
  });

  it('setColor on highlighter updates highlighter color', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');
    tm.setColor('#00FF00');
    expect(tm.activeColor).toBe('#00FF00');
  });

  it('setColor is a no-op for the eraser (leaves pen and highlighter colors unchanged)', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    tm.setColor('#FF0000');
    tm.setTool('highlighter');
    tm.setColor('#00FF00');
    tm.setTool('eraser');
    tm.setColor('#123456');
    // eraser stores no color; pen/highlighter colors are untouched
    tm.setTool('pen');
    expect(tm.activeColor).toBe('#FF0000');
    tm.setTool('highlighter');
    expect(tm.activeColor).toBe('#00FF00');
  });

  it('switching tools preserves pen color', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    tm.setColor('#FF0000');
    tm.setTool('highlighter');
    tm.setTool('pen');
    expect(tm.activeColor).toBe('#FF0000');
  });

  it('switching tools preserves highlighter color', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');
    tm.setColor('#00FF00');
    tm.setTool('pen');
    tm.setTool('highlighter');
    expect(tm.activeColor).toBe('#00FF00');
  });

  it('activeSize returns pen size when pen active', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    expect(tm.activeSize).toBe(4);
  });

  it('activeSize returns highlighter size when highlighter active', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');
    expect(tm.activeSize).toBe(20);
  });

  it('activeOpacity returns 1 for pen', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    expect(tm.activeOpacity).toBe(1.0);
  });

  it('activeOpacity returns 0.3 for highlighter', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');
    expect(tm.activeOpacity).toBe(0.3);
  });

  it('getState returns full ToolState object', () => {
    const tm = new ToolManager();
    const state = tm.getState();
    expect(state).toEqual({
      activeTool: 'pen',
      penColor: '#ffffff',
      penSize: 4,
      highlighterColor: '#FFFF00',
      highlighterSize: 20,
      eraserSize: 10,
    });
  });

  it('default pen color is #ffffff', () => {
    const tm = new ToolManager();
    expect(tm.getState().penColor).toBe('#ffffff');
  });

  it('default highlighter color is #FFFF00', () => {
    const tm = new ToolManager();
    expect(tm.getState().highlighterColor).toBe('#FFFF00');
  });

  it('default pen size is 4', () => {
    const tm = new ToolManager();
    expect(tm.getState().penSize).toBe(4);
  });

  it('default highlighter size is 20', () => {
    const tm = new ToolManager();
    expect(tm.getState().highlighterSize).toBe(20);
  });

  it('setTool to selection changes activeTool', () => {
    const tm = new ToolManager();
    tm.setTool('selection');
    expect(tm.activeTool).toBe('selection');
  });

  it('activeColor when selection active returns pen color', () => {
    const tm = new ToolManager();
    tm.setTool('selection');
    expect(tm.activeColor).toBe('#ffffff');
  });

  it('activeSize when selection active returns pen size', () => {
    const tm = new ToolManager();
    tm.setTool('selection');
    expect(tm.activeSize).toBe(4);
  });

  it('setSize on pen tool updates pen size', () => {
    const tm = new ToolManager();
    tm.setTool('pen');

    tm.setSize(8);

    expect(tm.activeSize).toBe(8);
  });

  it('setSize on highlighter tool updates highlighter size', () => {
    const tm = new ToolManager();
    tm.setTool('highlighter');

    tm.setSize(30);

    expect(tm.activeSize).toBe(30);
  });

  it('setSize on eraser tool updates eraser size', () => {
    const tm = new ToolManager();
    tm.setTool('eraser');

    tm.setSize(25);

    expect(tm.activeSize).toBe(25);
  });

  it('default tool is pen on new instance', () => {
    const tm = new ToolManager();

    expect(tm.activeTool).toBe('pen');
  });

  it('switch tool changes activeColor to that tool color', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    tm.setColor('#FF0000');
    tm.setTool('highlighter');

    expect(tm.activeColor).toBe('#FFFF00');
  });

  it('per-tool color memory preserves pen color after switching', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    tm.setColor('#FF0000');
    tm.setTool('highlighter');
    tm.setColor('#00FF00');
    tm.setTool('pen');

    expect(tm.activeColor).toBe('#FF0000');
  });

  it('per-tool size memory preserves pen size after switching', () => {
    const tm = new ToolManager();
    tm.setTool('pen');
    tm.setSize(10);
    tm.setTool('eraser');
    tm.setTool('pen');

    expect(tm.activeSize).toBe(10);
  });

  it('setDefaults applies per-tool color/size for every tool and selects the active tool', () => {
    const tm = new ToolManager();
    tm.setDefaults({
      activeTool: 'pen',
      penColor: '#111111',
      penSize: 3,
      highlighterColor: '#abcdef',
      highlighterSize: 30,
      eraserSize: 15,
    });

    expect(tm.activeTool).toBe('pen');
    expect(tm.activeColor).toBe('#111111');
    expect(tm.activeSize).toBe(3);

    tm.setTool('highlighter');
    expect(tm.activeColor).toBe('#abcdef');
    expect(tm.activeSize).toBe(30);

    tm.setTool('eraser');
    expect(tm.activeSize).toBe(15);
  });

  it('setDefaults can select a non-pen default tool without corrupting other tools', () => {
    const tm = new ToolManager();
    tm.setDefaults({
      activeTool: 'highlighter',
      penColor: '#111111',
      highlighterColor: '#22ff22',
      highlighterSize: 25,
    });

    expect(tm.activeTool).toBe('highlighter');
    expect(tm.activeColor).toBe('#22ff22');
    expect(tm.activeSize).toBe(25);
    // Pen color was set, not clobbered by the highlighter default.
    tm.setTool('pen');
    expect(tm.activeColor).toBe('#111111');
  });
});
