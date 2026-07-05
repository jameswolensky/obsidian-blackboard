import { PluginSettingTab, App, Setting } from 'obsidian';
import type BlackboardPlugin from '../main';

export class BlackboardSettingTab extends PluginSettingTab {
  private plugin: BlackboardPlugin;

  constructor(app: App, plugin: BlackboardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'File Storage' });

    new Setting(containerEl)
      .setName('Drawing folder')
      .setDesc('Folder for new drawing files')
      .addText((text) =>
        text.setValue(this.plugin.settings.drawingFolder).onChange(async (value) => {
          this.plugin.settings.drawingFolder = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('New file location')
      .setDesc('Where to create new drawing files')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('fixed', 'Fixed folder')
          .addOption('current', 'Same as active file')
          .setValue(this.plugin.settings.newFileLocation)
          .onChange(async (value) => {
            this.plugin.settings.newFileLocation = value as 'fixed' | 'current';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Auto-export SVG')
      .setDesc('Automatically export an SVG file alongside each drawing')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoExportSvg).onChange(async (value) => {
          this.plugin.settings.autoExportSvg = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    if (this.plugin.settings.autoExportSvg) {
      new Setting(containerEl)
        .setName('SVG export path')
        .setDesc('Folder for exported SVGs (empty = same folder as drawing)')
        .addText((text) =>
          text.setValue(this.plugin.settings.svgExportPath).onChange(async (value) => {
            this.plugin.settings.svgExportPath = value;
            await this.plugin.saveSettings();
          }),
        );
    }

    // Toolbar palette: its own dedicated section. The eight controls map 1:1 to the
    // color-popover swatches, in display order (left-to-right, top-to-bottom).
    containerEl.createEl('h2', { text: 'Toolbar palette' });
    for (let i = 0; i < this.plugin.settings.paletteColors.length; i++) {
      new Setting(containerEl)
        .setName(`Color ${i + 1}`)
        .setDesc(`Swatch ${i + 1} in the toolbar color popover`)
        .addColorPicker((picker) =>
          picker.setValue(this.plugin.settings.paletteColors[i]).onChange(async (value) => {
            this.plugin.settings.paletteColors[i] = value;
            await this.plugin.saveSettings();
          }),
        );
    }

    // Toolbar behaviour (distinct from the palette colors above).
    containerEl.createEl('h2', { text: 'Toolbar' });

    new Setting(containerEl)
      .setName('Show toolbar pill')
      .setDesc(
        'Show the collapsed pen-icon pill on Markdown and Canvas pages with no active drawing, ' +
          'so there is always a button to start drawing. Turn off to hide it until a drawing is active.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showToolbarPill).onChange(async (value) => {
          this.plugin.settings.showToolbarPill = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
