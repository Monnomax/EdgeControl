import Gio from "gi://Gio";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { CustomOsd } from "./src/customOsd.js";
import { SystemOsdPatcher } from "./src/systemOsdPatcher.js";
import { MprisController } from "./src/mprisController.js";
import { VolumeBrightnessController } from "./src/volumeBrightnessController.js";
import { MonitorPowerController } from "./src/monitorPowerController.js";
import { EdgeTrigger } from "./src/edgeTrigger.js";
import { StartupLevelsController } from "./src/startupLevelsController.js";

export default class EdgeControlExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Системний шрифт інтерфейсу (той самий, що обраний користувачем
        // у "Налаштування > Універсальний доступ/Шрифти" або через Tweaks)
        this._interfaceSettings = new Gio.Settings({
            schema: "org.gnome.desktop.interface",
        });

        // Композиція модулів розширення:
        //  - CustomOsd               — власне OSD-вікно (іконка/текст/смужка);
        //  - SystemOsdPatcher        — приховує системний OSD гучності/яскравості;
        //  - MprisController         — спостереження за плеєрами + previous/next/play-pause;
        //  - VolumeBrightnessController — прокрутка колеса миші → гучність/яскравість;
        //  - MonitorPowerController  — вимкнення/увімкнення монітора довгим утриманням;
        //  - EdgeTrigger             — зона чутливості на лівому краю, маршрутизує події
        //                              між контролерами вище;
        //  - StartupLevelsController — відновлення гучності/яскравості при запуску
        //                              (останнє значення або профіль День/Ніч).
        this._osd = new CustomOsd(this._settings, this._interfaceSettings);
        this._systemOsdPatcher = new SystemOsdPatcher();
        this._mprisController = new MprisController(this._osd);
        this._volumeBrightnessController = new VolumeBrightnessController(
            this._settings,
            this._osd,
            this._systemOsdPatcher,
        );
        this._monitorPowerController = new MonitorPowerController();
        this._startupLevelsController = new StartupLevelsController(
            this._settings,
            this._systemOsdPatcher,
        );
        this._edgeTrigger = new EdgeTrigger(this._settings, {
            mprisController: this._mprisController,
            volumeBrightnessController: this._volumeBrightnessController,
            monitorPowerController: this._monitorPowerController,
        });

        this._applyAllSettings = () => {
            this._osd.applySettings();
            this._edgeTrigger.applySettings();
        };

        this._applyAllSettings();
        this._osd.warmUp();

        this._settingsId = this._settings.connect("changed", () =>
            this._applyAllSettings(),
        );
        this._fontSettingsId = this._interfaceSettings.connect(
            "changed::font-name",
            () => this._osd.applySettings(),
        );

        this._systemOsdPatcher.enable();
        this._edgeTrigger.enable();
        this._mprisController.enable();
        this._startupLevelsController.enable();
    }

    disable() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = null;
        }
        if (this._fontSettingsId) {
            this._interfaceSettings.disconnect(this._fontSettingsId);
            this._fontSettingsId = null;
        }
        this._interfaceSettings = null;

        if (this._mprisController) {
            this._mprisController.disable();
            this._mprisController = null;
        }
        if (this._edgeTrigger) {
            this._edgeTrigger.disable();
            this._edgeTrigger = null;
        }
        if (this._systemOsdPatcher) {
            this._systemOsdPatcher.disable();
            this._systemOsdPatcher = null;
        }
        if (this._monitorPowerController) {
            this._monitorPowerController.disable();
            this._monitorPowerController = null;
        }
        if (this._startupLevelsController) {
            this._startupLevelsController.disable();
            this._startupLevelsController = null;
        }
        if (this._osd) {
            this._osd.destroy();
            this._osd = null;
        }

        this._volumeBrightnessController = null;
        this._applyAllSettings = null;
        this._settings = null;
    }
}
