import Clutter from "gi://Clutter";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const EDGE_WIDTH = 5;

// ==========================================
// ЗОНА ЧУТЛИВОСТІ (EDGE TRIGGER)
// ==========================================
//
// Невидимий (або напівпрозорий, якщо увімкнено індикатор) St.Widget
// вздовж лівого краю монітора. Сам по собі нічого не регулює — лише
// приймає події миші й розподіляє їх за вертикальною позицією курсора
// між переданими контролерами:
//   - верхня половина: медіа-керування (MprisController) / гучність;
//   - нижня половина: яскравість / вимкнення монітора довгим утриманням
//     (MonitorPowerController).
export class EdgeTrigger {
    constructor(
        settings,
        { mprisController, volumeBrightnessController, monitorPowerController },
    ) {
        this._settings = settings;
        this._mprisController = mprisController;
        this._volumeBrightnessController = volumeBrightnessController;
        this._monitorPowerController = monitorPowerController;

        this._edgeTrigger = null;
        this._monitorsChangedId = null;
    }

    enable() {
        this._edgeTrigger = new St.Widget({
            name: "EdgeControlTrigger",
            width: EDGE_WIDTH,
            height: Main.layoutManager.primaryMonitor.height,
            x: 0,
            y: 0,
            reactive: true,
        });

        Main.layoutManager.addChrome(this._edgeTrigger);

        this._edgeTrigger.connect("scroll-event", (actor, event) =>
            this._onScroll(event),
        );
        this._edgeTrigger.connect("button-press-event", (actor, event) =>
            this._onButtonPress(event),
        );
        this._edgeTrigger.connect("button-release-event", (actor, event) =>
            this._onButtonRelease(event),
        );

        this._monitorsChangedId = Main.layoutManager.connect(
            "monitors-changed",
            () => this.applySettings(),
        );
    }

    _isUpperHalf(event) {
        const [, y] = event.get_coords();
        const halfHeight = Main.layoutManager.primaryMonitor.height / 2;
        return y < halfHeight;
    }

    _onScroll(event) {
        return this._isUpperHalf(event)
            ? this._volumeBrightnessController.handleVolumeScroll(event)
            : this._volumeBrightnessController.handleBrightnessScroll(event);
    }

    _onButtonPress(event) {
        if (this._isUpperHalf(event)) {
            return this._mprisController.handleButton(event);
        }

        // Нижня зона (там же, де регулюється яскравість) — довге утримання ЛКМ
        // вимикає монітор
        if (event.get_button() === 1) {
            this._monitorPowerController.startLongPress();
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onButtonRelease(event) {
        if (event.get_button() === 1) {
            this._monitorPowerController.cancelLongPress();
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // Оновлює розмір/позицію/стиль зони чутливості (розмір та стиль)
    applySettings() {
        if (!this._edgeTrigger || !this._settings) return;

        const edgeWidth = this._settings.get_int("edge-width");
        const edgeHeightPercent = this._settings.get_int("edge-height");
        const showIndicator = this._settings.get_boolean(
            "edge-show-indicator",
        );

        const monitor = Main.layoutManager.primaryMonitor;
        const edgeHeight = Math.round(
            (monitor.height * edgeHeightPercent) / 100,
        );

        this._edgeTrigger.set_width(edgeWidth);
        this._edgeTrigger.set_height(edgeHeight);

        // Центруємо зону по вертикалі вздовж лівого краю монітора
        const edgeX = monitor.x;
        const edgeY = monitor.y + Math.round((monitor.height - edgeHeight) / 2);
        this._edgeTrigger.set_position(edgeX, edgeY);

        // Застосовуємо білий фон, якщо включено показ індикатора
        if (showIndicator) {
            this._edgeTrigger.set_style(
                "background-color: rgba(255, 255, 255, 0.5);",
            );
        } else {
            this._edgeTrigger.set_style("");
        }
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }
        if (this._edgeTrigger) {
            Main.layoutManager.removeChrome(this._edgeTrigger);
            this._edgeTrigger.destroy();
            this._edgeTrigger = null;
        }
        this._mprisController = null;
        this._volumeBrightnessController = null;
        this._monitorPowerController = null;
        this._settings = null;
    }
}
